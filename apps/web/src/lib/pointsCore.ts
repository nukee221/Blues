import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  awardPoints,
  bracketFinishPositions,
  pointsTable,
  rankWithTies,
  strokePlayLeaderboard,
  type Placing,
  type TeeInfo,
} from '@hgt/scoring';
import { ActionError } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { findBracket } from '@/lib/bracketCore';
import { getTeeInfo } from '@/lib/courses';
import { playInCards, type PlayInMember, type PlayInScore } from '@/lib/playIn';

/**
 * Event points with the service-role client (callers check the commissioner): the event's
 * placings (bracket finish, or the stroke-play total over every stroke round), the season's
 * points table for the event type, and the award rows those give.
 */

export type PointsEvent = {
  id: string;
  season_id: string;
  name: string;
  event_type: string;
  format: string | null;
  status: string;
  handicap_mode: 'gross' | 'net' | null;
};
export type Computed = { playerId: string; points: number };
export type AwardRow = { player_id: string; points: number; override: boolean };

export async function loadPointsEvent(admin: SupabaseClient, eventId: string): Promise<PointsEvent> {
  const { data, error } = await admin
    .from('events')
    .select('id, season_id, name, event_type, format, status, handicap_mode')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(ACT.notFound, 'Event not found');
  return data as PointsEvent;
}

/**
 * The season's points_tables row for the event type, values as stored (commissioners may
 * have edited them); pointsTable(500) only when the season has no row for the type.
 */
export async function eventTable(admin: SupabaseClient, ev: PointsEvent): Promise<{ table: number[]; source: 'season' | 'default' }> {
  const { data, error } = await admin
    .from('points_tables')
    .select('table_values')
    .eq('season_id', ev.season_id)
    .eq('event_type', ev.event_type)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const values = (data as { table_values: unknown[] | null } | null)?.table_values;
  if (!Array.isArray(values)) return { table: pointsTable(500), source: 'default' };
  return { table: values.map(Number), source: 'season' };
}

/** Match play: the drawn bracket with a decided final, else 'bracket_incomplete'. Non-advancers have no placing. */
async function bracketPlacings(admin: SupabaseClient, ev: PointsEvent): Promise<Placing[]> {
  const row = await findBracket(admin, ev.id);
  const bracket = row?.state.bracket;
  const final = bracket?.matches.find((m) => m.round === bracket.rounds);
  if (!bracket || !final || final.winner === null) {
    throw new ActionError(ACT.bracketIncomplete, !bracket ? 'The bracket has not been drawn' : 'The bracket final has not been decided');
  }
  return bracketFinishPositions(bracket);
}

type Member = PlayInMember & { group_id: string };

/**
 * Stroke play: every card (group) with a player still in must be locked ('cards_unsigned').
 * A player is placed only with a complete card (every hole of the tee) in every stroke round
 * and no withdrawal; placings rank the total over the rounds (net or gross, the event's
 * handicap mode), equal totals tied.
 */
async function strokePlacings(admin: SupabaseClient, ev: PointsEvent): Promise<Placing[]> {
  const { data: rounds, error: rErr } = await admin.from('rounds').select('id, tee_id, kind').eq('event_id', ev.id).eq('kind', 'stroke');
  if (rErr) throw new Error(rErr.message);
  const roundList = (rounds ?? []) as { id: string; tee_id: string }[];
  if (roundList.length === 0) throw new ActionError(ACT.noGroups, 'The event has no stroke rounds');
  const { data: groups, error: gErr } = await admin.from('groups').select('id, round_id, locked').in('round_id', roundList.map((r) => r.id));
  if (gErr) throw new Error(gErr.message);
  const groupList = (groups ?? []) as { id: string; round_id: string; locked: boolean }[];
  if (groupList.length === 0) throw new ActionError(ACT.noGroups, 'The event has no groups');
  const groupIds = groupList.map((g) => g.id);

  const { data: gp, error: mErr } = await admin.from('group_players').select('group_id, player_id, playing_handicap, withdrawn').in('group_id', groupIds);
  if (mErr) throw new Error(mErr.message);
  const members = (gp ?? []) as Member[];
  const unsigned = groupList.filter((g) => !g.locked && members.some((m) => m.group_id === g.id && !m.withdrawn)).length;
  if (unsigned > 0) {
    throw new ActionError(ACT.cardsUnsigned, `Every card must be signed first: ${unsigned} card${unsigned === 1 ? '' : 's'} not signed`);
  }

  // One query per card keeps each well under PostgREST's row cap.
  const scoreLists = await Promise.all(
    groupIds.map(async (gid) => {
      const { data, error } = await admin.from('scores').select('player_id, hole, gross').eq('group_id', gid);
      if (error) throw new Error(error.message);
      return [gid, (data ?? []) as PlayInScore[]] as const;
    }),
  );
  const scoresOf = new Map(scoreLists);

  const mode: 'gross' | 'net' = ev.handicap_mode === 'net' ? 'net' : 'gross';
  const tees = new Map<string, Promise<TeeInfo>>();
  const teeOf = (id: string) => {
    if (!tees.has(id)) tees.set(id, getTeeInfo(id, admin));
    return tees.get(id)!;
  };

  const totals = new Map<string, number>();
  const out = new Set<string>();
  for (const [k, round] of roundList.entries()) {
    const tee = await teeOf(round.tee_id);
    const inRound = new Set(groupList.filter((g) => g.round_id === round.id).map((g) => g.id));
    const complete = new Map<string, number>();
    for (const gid of inRound) {
      const ms = members.filter((m) => m.group_id === gid);
      for (const m of ms) if (m.withdrawn) out.add(m.player_id);
      const cards = playInCards(ms.filter((m) => !m.withdrawn), scoresOf.get(gid) ?? []);
      for (const r of strokePlayLeaderboard(cards, tee, mode)) {
        if (r.thru === tee.holes.length) complete.set(r.playerId, mode === 'net' ? r.net : r.gross);
      }
    }
    if (k === 0) for (const [p, t] of complete) totals.set(p, t);
    for (const p of [...totals.keys()]) {
      const t = complete.get(p);
      if (t === undefined) totals.delete(p);
      else if (k > 0) totals.set(p, totals.get(p)! + t);
    }
  }
  for (const p of out) totals.delete(p);
  return rankWithTies([...totals.entries()], ([, t]) => t).map(({ item, position, tied }) => ({ playerId: item[0], position, tied }));
}

/** The awards the event earns now (no DB writes). Throws 'bracket_incomplete' / 'cards_unsigned'. */
export async function computeAwards(
  admin: SupabaseClient,
  ev: PointsEvent,
): Promise<{ awards: Computed[]; table: number[]; source: 'season' | 'default' }> {
  const placings = ev.format === 'match_play' ? await bracketPlacings(admin, ev) : await strokePlacings(admin, ev);
  const { table, source } = await eventTable(admin, ev);
  return { awards: awardPoints(placings, table), table, source };
}

export async function awardRows(admin: SupabaseClient, eventId: string): Promise<AwardRow[]> {
  const { data, error } = await admin.from('points_awards').select('player_id, points, override').eq('event_id', eventId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as AwardRow[]).map((r) => ({ player_id: r.player_id, points: Number(r.points), override: r.override === true }));
}

/**
 * Replace the event's non-override rows with `computed`; override rows stay untouched (and
 * win over a computed value for the same player). Returns the rows now stored.
 */
export async function replaceAwards(admin: SupabaseClient, eventId: string, computed: Computed[]): Promise<AwardRow[]> {
  const before = await awardRows(admin, eventId);
  const overridden = new Set(before.filter((r) => r.override).map((r) => r.player_id));
  const { error: delErr } = await admin.from('points_awards').delete().eq('event_id', eventId).eq('override', false);
  if (delErr) throw new Error(delErr.message);
  const rows = computed
    .filter((a) => !overridden.has(a.playerId))
    .map((a) => ({ event_id: eventId, player_id: a.playerId, points: a.points, override: false }));
  if (rows.length) {
    const { error } = await admin.from('points_awards').insert(rows);
    if (error) throw new Error(error.message);
  }
  return [...before.filter((r) => r.override), ...rows.map((r) => ({ player_id: r.player_id, points: r.points, override: false }))];
}
