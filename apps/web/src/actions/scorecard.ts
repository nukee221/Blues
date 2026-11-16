'use server';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { HoleInfo } from '@hgt/scoring';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTeeInfo } from '@/lib/courses';
import { normalizeCode } from '@/lib/codes';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { REJECT, SC } from '@/lib/scorecardCodes';

/**
 * Group-code scorecard. No login: the 6-character code is the credential, so every
 * action looks the group up by code with the service role and returns only what a
 * code holder may see (never the code of another group, never scorer_device_token).
 * The scorer is whichever device (httpOnly `hgt_dev` cookie) claimed the card.
 * User-facing failures are returned as ActionResult codes (see lib/scorecardCodes).
 */

export type GroupView = {
  groupId: string;
  locked: boolean;
  isScorerDevice: boolean;
  /** Some device (maybe this one) holds the scorer role. */
  hasScorerDevice: boolean;
  scorerPlayerId: string | null;
  players: { id: string; name: string; playingHandicap: number }[];
  holes: HoleInfo[];
  /**
   * Gross per player. Index i < holes.length is holes[i]; for match rounds the arrays
   * may run longer: index holes.length + k is extra hole 19 + k.
   */
  scores: Record<string, (number | null)[]>;
  kind: 'stroke' | 'match';
  handicapMode: 'gross' | 'net';
  matchStrokes: 'full' | 'offLow';
  startHole: number;
  eventName: string;
  roundNumber: number;
};

export type ScoreInput = { playerId: string; hole: number; gross: number; clientTs: string };
export type RejectedScore = { playerId: string; hole: number; reason: string };
export type SaveResult = { accepted: number; rejected: RejectedScore[] };

const DEVICE_COOKIE = 'hgt_dev';
const DEVICE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url
const ONE_YEAR = 60 * 60 * 24 * 365;
const MAX_HOLE = 36; // 19..36: match-play extra holes
const MAX_BATCH = 500;

const entrySchema = z.object({
  playerId: z.string().uuid(),
  hole: z.number().int().min(1).max(MAX_HOLE),
  gross: z.number().int('Gross must be a whole number').min(1, 'Gross must be 1–15').max(15, 'Gross must be 1–15'),
  clientTs: z.iso.datetime({ offset: true }),
});

type Admin = ReturnType<typeof createAdminClient>;
type GroupRow = {
  id: string;
  round_id: string;
  start_hole: number;
  scorer_player_id: string | null;
  scorer_device_token: string | null;
  scorer_self_claimed: boolean | null;
  locked: boolean;
  signed_at: string | null;
};

function parseCode(input: string): string {
  const code = normalizeCode(input);
  if (!code) throw new ActionError(SC.invalidCode, 'That is not a valid code');
  return code;
}

/** This device's token; created (and set as a cookie) when `create` and absent. */
async function deviceToken(create: boolean): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  if (existing && DEVICE_RE.test(existing)) return existing;
  if (!create) return null;
  const token = randomBytes(32).toString('base64url');
  try {
    store.set(DEVICE_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ONE_YEAR,
      path: '/',
    });
  } catch {
    // Rendering a Server Component cannot set cookies; the page's first action call will.
    return null;
  }
  return token;
}

async function groupByCode(admin: Admin, code: string): Promise<GroupRow> {
  const { data, error } = await admin
    .from('groups')
    .select('id, round_id, start_hole, scorer_player_id, scorer_device_token, scorer_self_claimed, locked, signed_at')
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(SC.notFound, 'No group has that code');
  return data as GroupRow;
}

async function membersOf(admin: Admin, groupId: string) {
  const { data, error } = await admin.from('group_players').select('player_id, playing_handicap').eq('group_id', groupId);
  if (error) throw new Error(error.message);
  return (data ?? []) as { player_id: string; playing_handicap: number | null }[];
}

async function roundOf(admin: Admin, roundId: string) {
  const { data: round, error } = await admin
    .from('rounds')
    .select('id, event_id, round_number, tee_id, kind')
    .eq('id', roundId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!round) throw new ActionError(SC.notFound, 'Round not found');
  return round as { id: string; event_id: string; round_number: number; tee_id: string; kind: 'stroke' | 'match' };
}

const isSigned = (g: { locked: boolean; signed_at: string | null }) => g.locked || !!g.signed_at;

export async function openGroup(code: string): Promise<ActionResult<GroupView>> {
  return toResult(async () => {
    const c = parseCode(code);
    const device = await deviceToken(true);
    const admin = createAdminClient();
    const group = await groupByCode(admin, c);
    const round = await roundOf(admin, group.round_id);
    const [{ data: event, error: eventError }, members, tee, { data: rows, error: scoreError }] = await Promise.all([
      admin.from('events').select('name, handicap_mode, match_strokes').eq('id', round.event_id).maybeSingle(),
      membersOf(admin, group.id),
      getTeeInfo(round.tee_id, admin),
      admin.from('scores').select('player_id, hole, gross').eq('group_id', group.id),
    ]);
    if (eventError) throw new Error(eventError.message);
    if (scoreError) throw new Error(scoreError.message);
    if (!event) throw new ActionError(SC.notFound, 'Event not found');
    const ev = event as { name: string; handicap_mode: 'gross' | 'net' | null; match_strokes: 'full' | 'offLow' };

    const ids = members.map((m) => m.player_id);
    const { data: people, error: peopleError } = ids.length
      ? await admin.from('players').select('id, name').in('id', ids)
      : { data: [], error: null };
    if (peopleError) throw new Error(peopleError.message);
    const nameOf = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
    const players = members
      .map((m) => ({ id: m.player_id, name: nameOf.get(m.player_id) ?? 'Player', playingHandicap: m.playing_handicap ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    const indexOf = new Map(tee.holes.map((h, i) => [h.number, i]));
    const slot = (hole: number) =>
      hole > 18 ? (round.kind === 'match' ? tee.holes.length + (hole - 19) : undefined) : indexOf.get(hole);
    const list = (rows ?? []) as { player_id: string; hole: number; gross: number | null }[];
    const length = Math.max(tee.holes.length, ...list.map((r) => (slot(r.hole) ?? -1) + 1));
    const scores: Record<string, (number | null)[]> = {};
    for (const p of players) scores[p.id] = Array<number | null>(length).fill(null);
    for (const r of list) {
      const i = slot(r.hole);
      if (i !== undefined && scores[r.player_id]) scores[r.player_id]![i] = r.gross;
    }

    return {
      groupId: group.id,
      locked: isSigned(group),
      isScorerDevice: !!device && group.scorer_device_token === device,
      hasScorerDevice: !!group.scorer_device_token,
      scorerPlayerId: group.scorer_player_id,
      players,
      holes: tee.holes,
      scores,
      kind: round.kind,
      handicapMode: ev.handicap_mode ?? 'net',
      matchStrokes: ev.match_strokes,
      startHole: group.start_hole,
      eventName: ev.name,
      roundNumber: round.round_number,
    };
  });
}

const ANOTHER_PHONE = 'Another phone is already keeping score for this group';

/**
 * Make this device the group's scorer. Allowed when no device holds the card yet (the
 * commissioner frees it with releaseScorer for a hand-off). A commissioner-assigned
 * scorer must be the one claiming; a self-claimed scorer can be replaced once the
 * phone is freed. Otherwise the claim records the player.
 */
export async function claimScorer(code: string, playerId: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    const c = parseCode(code);
    const pid = z.string().uuid().parse(playerId);
    const device = await deviceToken(true);
    if (!device) throw new ActionError(SC.noDevice, 'Could not identify this phone; reload and try again');
    const admin = createAdminClient();
    const group = await groupByCode(admin, c);
    if (isSigned(group)) throw new ActionError(SC.locked, 'Card is signed');
    const members = await membersOf(admin, group.id);
    if (!members.some((m) => m.player_id === pid)) throw new ActionError(SC.notInGroup, 'That player is not in this group');
    if (group.scorer_device_token && group.scorer_device_token !== device) throw new ActionError(SC.otherDevice, ANOTHER_PHONE);
    const assigned = group.scorer_player_id && !group.scorer_self_claimed ? group.scorer_player_id : null;
    if (assigned && assigned !== pid) {
      const { data: who } = await admin.from('players').select('name').eq('id', assigned).maybeSingle();
      throw new ActionError(
        SC.presetScorer,
        `The commissioner assigned ${(who as { name: string } | null)?.name ?? 'another player'} as scorer`,
      );
    }
    if (group.scorer_device_token === device && group.scorer_player_id === pid) return null;

    // Conditional on what we read, so two phones claiming at once cannot both win.
    let q = admin
      .from('groups')
      .update({ scorer_device_token: device, scorer_player_id: pid, scorer_self_claimed: !assigned })
      .eq('id', group.id)
      .eq('locked', false)
      .is('signed_at', null);
    q = group.scorer_device_token ? q.eq('scorer_device_token', device) : q.is('scorer_device_token', null);
    q = group.scorer_player_id ? q.eq('scorer_player_id', group.scorer_player_id) : q.is('scorer_player_id', null);
    const { data, error } = await q.select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ActionError(SC.otherDevice, ANOTHER_PHONE);
    return null;
  });
}

/** Commissioner: free a group's scorer device (dead phone, hand-off). The scorer player stays. */
export async function releaseScorer(groupId: string): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = z.string().uuid().parse(groupId);
    const admin = createAdminClient();
    const { data: group, error } = await admin
      .from('groups')
      .select('id, scorer_player_id, scorer_device_token, locked, signed_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!group) throw new ActionError(SC.notFound, 'Group not found');
    const g = group as { id: string; scorer_player_id: string | null; scorer_device_token: string | null; locked: boolean; signed_at: string | null };
    if (isSigned(g)) throw new ActionError(SC.locked, 'Card is signed');
    const { error: updateError } = await admin
      .from('groups')
      .update({ scorer_device_token: null })
      .eq('id', id)
      .eq('locked', false)
      .is('signed_at', null);
    if (updateError) throw new Error(updateError.message);
    const { error: auditError } = await admin.from('audit_log').insert({
      actor_player_id: player.id,
      entity: 'group',
      entity_id: id,
      before: { scorer_player_id: g.scorer_player_id, scorer_device: g.scorer_device_token ? 'held' : 'none' },
      after: { scorer_player_id: g.scorer_player_id, scorer_device: 'none' },
    });
    if (auditError) throw new Error(auditError.message);
    return null;
  });
}

function rejectionKey(raw: unknown): { playerId: string; hole: number } {
  const r = (raw ?? {}) as { playerId?: unknown; hole?: unknown };
  return { playerId: typeof r.playerId === 'string' ? r.playerId : '', hole: typeof r.hole === 'number' ? r.hole : 0 };
}

/**
 * Save scores from the scorer device. Whole-batch failures (bad code, signed card, not
 * the scorer) are returned as codes; a bad entry is rejected on its own, with a reason,
 * so it cannot block the rest. Last write wins by client_ts (clamped to server now); an
 * entry older than the server copy is skipped. `accepted` counts rows written.
 * Holes 19+ are match-play extra holes (tee hole ((n - 1) % 18) + 1).
 */
export async function saveScores(code: string, entries: ScoreInput[]): Promise<ActionResult<SaveResult>> {
  return toResult(async () => {
    const c = parseCode(code);
    if (!Array.isArray(entries) || entries.length > MAX_BATCH) {
      throw new ActionError(SC.invalid, `Send between 0 and ${MAX_BATCH} scores at a time`);
    }
    const device = await deviceToken(false);
    const admin = createAdminClient();
    const group = await groupByCode(admin, c);
    if (isSigned(group)) throw new ActionError(SC.locked, 'Card is signed');
    if (!device || group.scorer_device_token !== device) throw new ActionError(SC.notScorer, 'Only the scorer can enter scores');
    if (entries.length === 0) return { accepted: 0, rejected: [] };

    const members = new Set((await membersOf(admin, group.id)).map((m) => m.player_id));
    const round = await roundOf(admin, group.round_id);
    const holeNumbers = new Set((await getTeeInfo(round.tee_id, admin)).holes.map((h) => h.number));

    const rejected: RejectedScore[] = [];
    const valid: ScoreInput[] = [];
    for (const raw of entries as unknown[]) {
      const parsed = entrySchema.safeParse(raw);
      if (!parsed.success) {
        const onGross = parsed.error.issues.every((i) => i.path[0] === 'gross');
        rejected.push({ ...rejectionKey(raw), reason: onGross ? REJECT.badGross : REJECT.invalid });
        continue;
      }
      const e = parsed.data;
      const reject = (reason: string) => rejected.push({ playerId: e.playerId, hole: e.hole, reason });
      if (!members.has(e.playerId)) reject(REJECT.notInGroup);
      else if (e.hole > 18 && round.kind !== 'match') reject(REJECT.noExtraHoles);
      else if (!holeNumbers.has(e.hole > 18 ? ((e.hole - 1) % 18) + 1 : e.hole)) reject(REJECT.badHole);
      else valid.push(e);
    }

    // Clamp to server now and keep the newest entry per (player, hole).
    const now = Date.now();
    const newest = new Map<string, { playerId: string; hole: number; gross: number; t: number }>();
    for (const e of valid) {
      const t = Math.min(Date.parse(e.clientTs), now);
      const k = `${e.playerId}:${e.hole}`;
      const prev = newest.get(k);
      if (!prev || t > prev.t) newest.set(k, { playerId: e.playerId, hole: e.hole, gross: e.gross, t });
    }
    if (newest.size === 0) return { accepted: 0, rejected };

    const { data: rows, error } = await admin
      .from('scores')
      .select('id, player_id, hole, client_ts')
      .eq('group_id', group.id);
    if (error) throw new Error(error.message);
    const existing = new Map(
      ((rows ?? []) as { id: string; player_id: string; hole: number; client_ts: string | null }[]).map((r) => [
        `${r.player_id}:${r.hole}`,
        r,
      ]),
    );

    let accepted = 0;
    const inserts: Record<string, unknown>[] = [];
    for (const [k, e] of newest) {
      const ts = new Date(e.t).toISOString();
      const row = existing.get(k);
      if (!row) {
        inserts.push({ group_id: group.id, player_id: e.playerId, hole: e.hole, gross: e.gross, client_ts: ts });
        continue;
      }
      if (row.client_ts && Date.parse(row.client_ts) >= e.t) continue; // server copy is as new or newer
      // Atomic last-write-wins: only replace a row that is still older than this entry.
      const base = admin.from('scores').update({ gross: e.gross, client_ts: ts }).eq('id', row.id);
      const { data: hit, error: upError } = await (row.client_ts ? base.lt('client_ts', ts) : base.is('client_ts', null)).select('id');
      if (upError) throw new Error(upError.message);
      accepted += (hit ?? []).length;
    }
    if (inserts.length) {
      const { error: insError } = await admin.from('scores').insert(inserts);
      if (insError) {
        // A concurrent save created one of these rows; the queue retries and takes the update path.
        if (insError.code === '23505') throw new ActionError(SC.conflict, 'Scores changed while saving; retrying');
        throw new Error(insError.message);
      }
      accepted += inserts.length;
    }
    return { accepted, rejected };
  });
}
