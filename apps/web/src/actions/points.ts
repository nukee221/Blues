'use server';
import { z } from 'zod';
import { round2, seasonStandings, type Award, type StandingsRow } from '@hgt/scoring';
import { requireCommissioner, requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { EVENT_TYPES, type EventType } from '@/lib/eventStatus';
import { transitionEventStatus } from '@/lib/eventTransition';
import { awardRows, computeAwards, loadPointsEvent, replaceAwards } from '@/lib/pointsCore';

/**
 * Season points: finalize an event (award its points and set it final), commissioner
 * overrides, the per-season points tables, and the season standings. Commissioner actions
 * check auth first, write with the service role and leave audit rows; standings read with
 * the signed-in user's client (RLS: points_awards of non-draft events only, 0002).
 */

const uuid = z.string().uuid('Invalid id');
/** points_awards.points is numeric(8,2). */
const MAX_POINTS = 999999.99;
const twoDecimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
const pointsSchema = z
  .number({ error: 'Points must be a number' })
  .finite('Points must be a number')
  .min(0, 'Points cannot be negative')
  .max(MAX_POINTS, 'Too many points')
  .refine(twoDecimals, 'Points can have at most 2 decimals');

const audit = async (admin: ReturnType<typeof createAdminClient>, actor: string, entity: string, entityId: string, before: unknown, after: unknown) => {
  const { error } = await admin.from('audit_log').insert({ actor_player_id: actor, entity, entity_id: entityId, before, after });
  if (error) throw new Error(error.message);
};

export type FinalizeResult = { awards: { playerId: string; points: number; override: boolean }[] };

/**
 * Commissioner: award the event's points and set it final. In progress -> final through the
 * same guarded, audited transition as setEventStatus; already final -> recompute (idempotent,
 * the "Recalculate" button). Match play needs a drawn bracket with a decided final
 * ('bracket_incomplete'); stroke play needs every card with a player still in locked
 * ('cards_unsigned'). Non-override rows are replaced, override rows kept; one audit row
 * summarizes the awards. Nothing is written when a check fails.
 */
export async function finalizeEvent(eventId: string): Promise<ActionResult<FinalizeResult>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const admin = createAdminClient();
    const ev = await loadPointsEvent(admin, id);
    if (ev.status !== 'in_progress' && ev.status !== 'final') {
      throw new ActionError(ACT.wrongStatus, 'Only an event in progress (or already final) can be finalized');
    }
    const { awards, table, source } = await computeAwards(admin, ev);
    const recompute = ev.status === 'final';
    if (!recompute) await transitionEventStatus(admin, player.id, id, 'final');
    const before = await awardRows(admin, id);
    const stored = await replaceAwards(admin, id, awards);
    await audit(admin, player.id, 'points_awards', id, { awards: before }, {
      action: 'finalize',
      recompute,
      table_source: source,
      table,
      awards: stored,
    });
    return { awards: stored.map((r) => ({ playerId: r.player_id, points: r.points, override: r.override })) };
  });
}

async function requirePlayer(admin: ReturnType<typeof createAdminClient>, playerId: string) {
  const { data, error } = await admin.from('players').select('id').eq('id', playerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(ACT.notFound, 'Player not found');
}

/** Commissioner: set a player's points for an event by hand (override=true: kept by every later finalize). Audited. */
export async function overridePoints(eventId: string, playerId: string, points: number): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const pid = uuid.parse(playerId);
    const value = round2(pointsSchema.parse(points));
    const admin = createAdminClient();
    await loadPointsEvent(admin, id);
    await requirePlayer(admin, pid);
    const existing = (await awardRows(admin, id)).find((r) => r.player_id === pid) ?? null;
    if (existing) {
      const { error } = await admin.from('points_awards').update({ points: value, override: true }).eq('event_id', id).eq('player_id', pid);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from('points_awards').insert({ event_id: id, player_id: pid, points: value, override: true });
      if (error) throw new Error(error.message);
    }
    await audit(admin, player.id, 'points_award', id, existing, { player_id: pid, points: value, override: true, action: 'override' });
    return null;
  });
}

/**
 * Commissioner: undo an override. The row goes; on a final event the player's computed
 * points are written back at once (none when the player has no placing), otherwise the next
 * finalize computes them. 'not_found' when the player has no override. Audited.
 */
export async function clearOverride(eventId: string, playerId: string): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const pid = uuid.parse(playerId);
    const admin = createAdminClient();
    const ev = await loadPointsEvent(admin, id);
    const existing = (await awardRows(admin, id)).find((r) => r.player_id === pid && r.override);
    if (!existing) throw new ActionError(ACT.notFound, 'This player has no override for the event');
    // Compute before deleting, so a failed check (e.g. a reopened card) changes nothing.
    const computed = ev.status === 'final' ? ((await computeAwards(admin, ev)).awards.find((a) => a.playerId === pid)?.points ?? null) : null;
    const { error } = await admin.from('points_awards').delete().eq('event_id', id).eq('player_id', pid).eq('override', true);
    if (error) throw new Error(error.message);
    if (computed !== null) {
      const { error: insErr } = await admin.from('points_awards').insert({ event_id: id, player_id: pid, points: computed, override: false });
      if (insErr) throw new Error(insErr.message);
    }
    await audit(admin, player.id, 'points_award', id, existing, { player_id: pid, points: computed, override: false, action: 'clear_override' });
    return null;
  });
}

const tableSchema = z
  .object({
    winnerPoints: z.number().finite().positive('Winner points must be more than 0').max(MAX_POINTS),
    values: z
      .array(z.number().finite('Every value must be a number').min(0, 'Values cannot be negative').max(MAX_POINTS))
      .min(1, 'The table needs at least one value')
      .max(200, 'At most 200 places'),
  })
  .refine((t) => t.values[0] === t.winnerPoints, 'The first value must equal the winner points')
  .refine((t) => t.values.every((v, i) => i === 0 || v <= t.values[i - 1]!), 'Values must not increase down the table');

/**
 * Commissioner: a season's points table for one event type (values index 0 = 1st). Final
 * events keep their awards until recalculated (finalizeEvent). Audited with before/after.
 */
export async function saveEventTypePoints(seasonId: string, eventType: EventType, winnerPoints: number, values: number[]): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const sid = uuid.parse(seasonId);
    const type = z.enum(EVENT_TYPES, { error: 'Unknown event type' }).parse(eventType);
    const t = tableSchema.parse({ winnerPoints, values });
    const admin = createAdminClient();
    const { data: season, error: sErr } = await admin.from('seasons').select('id').eq('id', sid).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!season) throw new ActionError(ACT.notFound, 'Season not found');

    const { data: current, error: cErr } = await admin
      .from('points_tables')
      .select('id, winner_points, table_values')
      .eq('season_id', sid)
      .eq('event_type', type)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    const row = { season_id: sid, event_type: type, winner_points: t.winnerPoints, table_values: t.values };
    let rowId: string;
    if (current) {
      rowId = current.id as string;
      const { error } = await admin.from('points_tables').update({ winner_points: t.winnerPoints, table_values: t.values }).eq('id', rowId);
      if (error) throw new Error(error.message);
    } else {
      const { data: made, error } = await admin.from('points_tables').insert(row).select('id').single();
      if (error || !made) throw new Error(error?.message ?? 'Could not save the points table');
      rowId = made.id as string;
    }
    const before = current
      ? { season_id: sid, event_type: type, winner_points: Number(current.winner_points), table_values: ((current.table_values ?? []) as unknown[]).map(Number) }
      : null;
    await audit(admin, player.id, 'points_table', rowId, before, row);
    return null;
  });
}

export type StandingsEntry = Omit<StandingsRow, 'byEvent'> & {
  name: string;
  handicapIndex: number | null;
  eventsPlayed: number;
  /** eventNumber is the event's place in the season (1 = first played), the same for every player. */
  byEvent: { eventId: string; eventName: string; eventNumber: number; points: number }[];
};

/**
 * Season standings over the season's final events, read with the signed-in user's client
 * (RLS shows only non-draft events and their awards; a reopened event does not count until
 * finalized again). Position ties share; the top 8 (ties at 8th included) qualify for the
 * Season Championship. byEvent is in event date order (first round's play date).
 */
export async function getStandings(seasonId: string): Promise<ActionResult<StandingsEntry[]>> {
  await requireUser();
  return toResult(async () => {
    const sid = uuid.parse(seasonId);
    const supabase = await createServerClient();
    const { data: events, error: eErr } = await supabase
      .from('events')
      .select('id, name, status, created_at')
      .eq('season_id', sid)
      .eq('status', 'final');
    if (eErr) throw new Error(eErr.message);
    const eventList = (events ?? []) as { id: string; name: string; created_at: string }[];
    if (eventList.length === 0) return [];
    const ids = eventList.map((e) => e.id);

    const [{ data: rounds, error: rErr }, { data: awards, error: aErr }] = await Promise.all([
      supabase.from('rounds').select('event_id, play_date').in('event_id', ids),
      supabase.from('points_awards').select('event_id, player_id, points').in('event_id', ids),
    ]);
    if (rErr) throw new Error(rErr.message);
    if (aErr) throw new Error(aErr.message);
    const firstDate = new Map<string, string>();
    for (const r of (rounds ?? []) as { event_id: string; play_date: string | null }[]) {
      if (r.play_date && (!firstDate.has(r.event_id) || r.play_date < firstDate.get(r.event_id)!)) firstDate.set(r.event_id, r.play_date);
    }
    const dateKey = (e: { id: string; created_at: string }) => firstDate.get(e.id) ?? e.created_at.slice(0, 10);
    const ordered = [...eventList].sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || a.created_at.localeCompare(b.created_at));
    const rank = new Map(ordered.map((e, i) => [e.id, i]));
    const nameOfEvent = new Map(ordered.map((e) => [e.id, e.name]));

    const list: Award[] = ((awards ?? []) as { event_id: string; player_id: string; points: unknown }[])
      .map((a) => ({ eventId: a.event_id, playerId: a.player_id, points: Number(a.points) }))
      .sort((a, b) => rank.get(a.eventId)! - rank.get(b.eventId)!);
    const rows = seasonStandings(list);
    if (rows.length === 0) return [];

    const { data: people, error: pErr } = await supabase
      .from('public_players')
      .select('id, name, handicap_index')
      .in('id', rows.map((r) => r.playerId));
    if (pErr) throw new Error(pErr.message);
    const personOf = new Map(((people ?? []) as { id: string; name: string; handicap_index: unknown }[]).map((p) => [p.id, p]));
    return rows.map((r) => {
      const person = personOf.get(r.playerId);
      return {
        ...r,
        name: person?.name ?? 'Player',
        handicapIndex: person?.handicap_index == null ? null : Number(person.handicap_index),
        eventsPlayed: r.byEvent.length,
        byEvent: r.byEvent.map((b) => ({ ...b, eventName: nameOfEvent.get(b.eventId) ?? 'Event', eventNumber: rank.get(b.eventId)! + 1 })),
      };
    });
  });
}
