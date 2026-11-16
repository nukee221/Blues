'use server';
import { z } from 'zod';
import { playingHandicap, type HandicapBasis } from '@hgt/scoring';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTeeInfo } from '@/lib/courses';
import { generateGroupCode } from '@/lib/codes';
import { getMailer, type Mailer } from '@/lib/mailer';
import { formatRoundDate, formatTeeTime } from '@/lib/time';
import { renderTeeSheetEmail, teeSheetSubject } from '@/emails/teeSheet';

const idSchema = z.string().uuid();
const groupSchema = z.object({
  id: z.string().uuid().optional(),
  teeTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Tee time must be HH:MM')
    .nullable(),
  startHole: z.number().int().min(1).max(18),
  playerIds: z.array(z.string().uuid()).min(1, 'A group needs at least one player'),
  scorerPlayerId: z.string().uuid().nullable(),
});
const groupsSchema = z.array(groupSchema);
export type GroupInput = z.infer<typeof groupSchema>;

type Admin = ReturnType<typeof createAdminClient>;
type RoundRow = { id: string; event_id: string; round_number: number; tee_id: string; play_date: string | null };
type EventRow = {
  id: string;
  name: string;
  status: string;
  allowance_pct: number;
  handicap_basis: HandicapBasis;
  handicap_mode: 'gross' | 'net' | null;
};
type GroupRow = {
  id: string;
  code: string | null;
  tee_time: string | null;
  start_hole: number;
  scorer_player_id: string | null;
  locked: boolean;
  signed_at: string | null;
};
type GroupPlayerRow = {
  id: string;
  group_id: string;
  player_id: string;
  index_snapshot: number | string | null;
  playing_handicap: number | null;
};
type PlayerRow = { id: string; name: string; email: string; handicap_index: number | string | null };

async function loadRound(admin: Admin, roundId: string): Promise<{ round: RoundRow; event: EventRow }> {
  const { data: round, error } = await admin
    .from('rounds')
    .select('id, event_id, round_number, tee_id, play_date')
    .eq('id', roundId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!round) throw new Error('Round not found');
  const { data: event, error: eventError } = await admin
    .from('events')
    .select('id, name, status, allowance_pct, handicap_basis, handicap_mode')
    .eq('id', (round as RoundRow).event_id)
    .maybeSingle();
  if (eventError) throw new Error(eventError.message);
  if (!event) throw new Error('Event not found');
  return { round: round as RoundRow, event: event as EventRow };
}

/** Service-role reads of a round's groups (code included) and their players. */
async function loadGroups(admin: Admin, roundId: string): Promise<{ groups: GroupRow[]; members: GroupPlayerRow[] }> {
  const { data: groups, error } = await admin
    .from('groups')
    .select('id, code, tee_time, start_hole, scorer_player_id, locked, signed_at')
    .eq('round_id', roundId);
  if (error) throw new Error(error.message);
  const list = (groups ?? []) as GroupRow[];
  if (list.length === 0) return { groups: [], members: [] };
  const { data: members, error: gpError } = await admin
    .from('group_players')
    .select('id, group_id, player_id, index_snapshot, playing_handicap')
    .in(
      'group_id',
      list.map((g) => g.id),
    );
  if (gpError) throw new Error(gpError.message);
  return { groups: list, members: (members ?? []) as GroupPlayerRow[] };
}

const setKey = (ids: string[]) => [...ids].sort().join(',');

async function audit(admin: Admin, actor: string, entity: string, entityId: string, before: unknown, after: unknown) {
  const { error } = await admin
    .from('audit_log')
    .insert({ actor_player_id: actor, entity, entity_id: entityId, before, after });
  if (error) throw new Error(error.message);
}

/**
 * Replace a round's groups. Every player must be registered for the event and in at most one
 * group; a scorer must be in their group. Refused once any group of the round is locked or
 * signed. A group whose player set is unchanged keeps its row (code, snapshots, scores);
 * a changed group is replaced by a new row with no code, so the next send issues a fresh one.
 */
export async function saveGroups(roundId: string, groups: GroupInput[]): Promise<void> {
  const { player } = await requireCommissioner();
  idSchema.parse(roundId);
  const input = groupsSchema.parse(groups);

  const seen = new Set<string>();
  for (const g of input) {
    for (const p of g.playerIds) {
      if (seen.has(p)) throw new Error('A player can be in only one group per round');
      seen.add(p);
    }
    if (g.scorerPlayerId && !g.playerIds.includes(g.scorerPlayerId)) {
      throw new Error('The scorer must be a player in that group');
    }
  }

  const admin = createAdminClient();
  const { event } = await loadRound(admin, roundId);
  if (event.status === 'final') throw new Error('Cannot change groups on a final event');

  if (seen.size > 0) {
    const { data: regs, error } = await admin
      .from('registrations')
      .select('player_id')
      .eq('event_id', event.id)
      .eq('status', 'registered')
      .in('player_id', [...seen]);
    if (error) throw new Error(error.message);
    const registered = new Set(((regs ?? []) as { player_id: string }[]).map((r) => r.player_id));
    const missing = [...seen].filter((p) => !registered.has(p));
    if (missing.length) throw new Error(`Not registered for this event: ${missing.length} player(s)`);
  }

  const existing = await loadGroups(admin, roundId);
  if (existing.groups.some((g) => g.locked || g.signed_at)) {
    throw new Error('Groups are locked: a scorecard for this round is locked or signed');
  }
  const keyOf = new Map<string, string>(); // existing group id -> player-set key
  for (const g of existing.groups) {
    keyOf.set(g.id, setKey(existing.members.filter((m) => m.group_id === g.id).map((m) => m.player_id)));
  }

  // Match each input group to an existing row with the same players (its own id first).
  const claimed = new Set<string>();
  const plan = input.map((g) => {
    const key = setKey(g.playerIds);
    let keepId: string | null = null;
    if (g.id && keyOf.get(g.id) === key && !claimed.has(g.id)) keepId = g.id;
    else {
      for (const [id, k] of keyOf) {
        if (k === key && !claimed.has(id)) {
          keepId = id;
          break;
        }
      }
    }
    if (keepId) claimed.add(keepId);
    return { g, keepId };
  });

  const stale = existing.groups.filter((g) => !claimed.has(g.id)).map((g) => g.id);
  if (stale.length) {
    const { error } = await admin.from('groups').delete().in('id', stale); // cascades group_players
    if (error) throw new Error(error.message);
  }

  for (const { g, keepId } of plan) {
    const fields = { tee_time: g.teeTime, start_hole: g.startHole, scorer_player_id: g.scorerPlayerId };
    if (keepId) {
      const prev = existing.groups.find((x) => x.id === keepId)!;
      const patch = prev.scorer_player_id === g.scorerPlayerId ? fields : { ...fields, scorer_device_token: null };
      const { error } = await admin.from('groups').update(patch).eq('id', keepId);
      if (error) throw new Error(error.message);
      continue;
    }
    const { data: created, error } = await admin
      .from('groups')
      .insert({ round_id: roundId, ...fields })
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Could not create group');
    const { error: gpError } = await admin
      .from('group_players')
      .insert(g.playerIds.map((p) => ({ group_id: (created as { id: string }).id, player_id: p })));
    if (gpError) throw new Error(gpError.message);
  }

  await audit(
    admin,
    player.id,
    'round',
    roundId,
    { groups: existing.groups.map((g) => ({ id: g.id, players: keyOf.get(g.id)?.split(',') ?? [] })) },
    {
      groups: plan.map(({ g, keepId }) => ({
        kept: keepId,
        teeTime: g.teeTime,
        startHole: g.startHole,
        players: g.playerIds,
        scorer: g.scorerPlayerId,
      })),
    },
  );
}

/** Give a group a unique code, retrying on a unique violation. Keeps a code set concurrently. */
async function assignCode(admin: Admin, groupId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGroupCode();
    const { data, error } = await admin
      .from('groups')
      .update({ code })
      .eq('id', groupId)
      .is('code', null)
      .select('code')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') continue;
      throw new Error(error.message);
    }
    if (data) return (data as { code: string }).code;
    const { data: row, error: readError } = await admin.from('groups').select('code').eq('id', groupId).maybeSingle();
    if (readError) throw new Error(readError.message);
    const existing = (row as { code: string | null } | null)?.code;
    if (existing) return existing;
    throw new Error('Group disappeared while sending');
  }
  throw new Error('Could not generate a unique group code; try again');
}

/**
 * Issue the round's tee sheet: a unique code per group, a handicap snapshot per player
 * (current index; event allowance and basis; the round's tee), and one email per player.
 * Idempotent: groups that already have a code and players that already have a snapshot
 * keep them, so a resend only re-emails. Moves the event registration_closed -> in_progress.
 */
export async function sendTeeSheet(roundId: string, mailer: Mailer): Promise<{ sent: number }> {
  const { player: actor } = await requireCommissioner();
  idSchema.parse(roundId);
  if (typeof mailer?.send !== 'function') throw new Error('A mailer is required');
  const admin = createAdminClient();

  const { round, event } = await loadRound(admin, roundId);
  if (event.status === 'draft') throw new Error('Cannot send a tee sheet for a draft event');
  if (event.status === 'final') throw new Error('Cannot send a tee sheet for a final event');
  const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
  if (!appUrl) throw new Error('APP_URL is not set');

  const { groups, members } = await loadGroups(admin, roundId);
  if (groups.length === 0 || members.length === 0) throw new Error('This round has no groups yet');

  const { data: players, error: playersError } = await admin
    .from('players')
    .select('id, name, email, handicap_index')
    .in(
      'id',
      members.map((m) => m.player_id),
    );
  if (playersError) throw new Error(playersError.message);
  const byId = new Map(((players ?? []) as PlayerRow[]).map((p) => [p.id, p]));

  // Validate everything before the first write.
  const toSnapshot = members.filter((m) => m.index_snapshot == null);
  for (const m of members) if (!byId.has(m.player_id)) throw new Error('A grouped player no longer exists');
  for (const m of toSnapshot) {
    const p = byId.get(m.player_id)!;
    if (p.handicap_index == null && event.handicap_mode !== 'gross') {
      throw new Error(`${p.name} has no handicap index`);
    }
  }
  const tee = toSnapshot.length ? await getTeeInfo(round.tee_id) : null;

  const codes = new Map<string, string>();
  for (const g of groups) codes.set(g.id, g.code ?? (await assignCode(admin, g.id)));

  for (const m of toSnapshot) {
    const raw = byId.get(m.player_id)!.handicap_index;
    const index = raw == null ? null : Number(raw);
    const playing = index == null ? null : playingHandicap(index, tee!, event.allowance_pct, event.handicap_basis);
    const { error } = await admin
      .from('group_players')
      .update({ index_snapshot: index, playing_handicap: playing })
      .eq('id', m.id);
    if (error) throw new Error(error.message);
  }

  if (event.status === 'registration_closed') {
    const { data: moved, error } = await admin
      .from('events')
      .update({ status: 'in_progress' })
      .eq('id', event.id)
      .eq('status', 'registration_closed')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (moved) await audit(admin, actor.id, 'event', event.id, { status: 'registration_closed' }, { status: 'in_progress' });
  }

  const roundDate = formatRoundDate(round.play_date);
  let sent = 0;
  for (const g of groups) {
    const code = codes.get(g.id)!;
    const inGroup = members.filter((m) => m.group_id === g.id).map((m) => byId.get(m.player_id)!);
    for (const p of inGroup) {
      await mailer.send({
        to: p.email,
        subject: teeSheetSubject({ eventName: event.name, roundNumber: round.round_number }),
        html: renderTeeSheetEmail({
          playerName: p.name,
          eventName: event.name,
          roundNumber: round.round_number,
          roundDate,
          teeTime: formatTeeTime(round.play_date, g.tee_time),
          startHole: g.start_hole,
          groupMates: inGroup.filter((x) => x.id !== p.id).map((x) => x.name),
          code,
          link: `${appUrl}/c/${code}`,
        }),
      });
      sent++;
    }
  }

  await audit(admin, actor.id, 'round', roundId, null, { tee_sheet_sent: sent });
  return { sent };
}

/** Page entry point: send with the configured mailer (Resend, or the fake one in dev). */
export async function sendRoundTeeSheet(roundId: string): Promise<{ sent: number }> {
  return sendTeeSheet(roundId, getMailer());
}
