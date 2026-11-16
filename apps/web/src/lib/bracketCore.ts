import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordWinner, type Bracket, type BracketMatch } from '@hgt/scoring';
import { ActionError } from '@/lib/actionResult';
import { loadCard } from '@/lib/cardData';
import { liveMatch } from '@/lib/scorecardView';
import { SG } from '@/lib/signingCodes';
import { BR, clearWinner, nextMatchOf, parseState, resultLabel, type BracketState } from '@/lib/bracketState';

/**
 * Bracket reads and writes with the service-role client, shared by the bracket actions and
 * the signing actions (auto-finalize on lock, the reopen guard). Callers do the auth checks.
 */

export type MatchEvent = {
  id: string;
  name: string;
  format: string | null;
  status: string;
  handicap_mode: 'gross' | 'net' | null;
  allowance_pct: number;
  handicap_basis: 'index' | 'course';
  match_strokes: 'full' | 'offLow';
};
export type BracketRow = { id: string; event_id: string; size: number; rounds: number; version: number; state: BracketState };
export type BracketMatchRow = {
  id: string;
  bracket_id: string;
  match_key: string;
  round: number;
  deadline: string | null;
  group_id: string | null;
  result: string | null;
  forfeit: boolean;
};

export const BM_COLS = 'id, bracket_id, match_key, round, deadline, group_id, result, forfeit';

export async function loadMatchEvent(admin: SupabaseClient, eventId: string): Promise<MatchEvent> {
  const { data, error } = await admin
    .from('events')
    .select('id, name, format, status, handicap_mode, allowance_pct, handicap_basis, match_strokes')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(BR.notFound, 'Event not found');
  const ev = data as MatchEvent;
  if (ev.format !== 'match_play') throw new ActionError(BR.notMatchPlay, 'This is not a match-play event');
  return ev;
}

export function requireInProgress(ev: MatchEvent): void {
  if (ev.status !== 'in_progress') throw new ActionError(BR.wrongStatus, 'The event is not in progress');
}

export async function findBracket(admin: SupabaseClient, eventId: string): Promise<BracketRow | null> {
  const { data, error } = await admin
    .from('brackets')
    .select('id, event_id, size, rounds, version, state')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Omit<BracketRow, 'state' | 'version'> & { state: unknown; version: number | null };
  return { ...row, version: row.version ?? 0, state: parseState(row.state) };
}

/** The drawn bracket of an event, or a 'play_in_open' / 'not_drawn' failure. */
export async function drawnBracket(admin: SupabaseClient, eventId: string): Promise<BracketRow & { bracket: Bracket }> {
  const row = await findBracket(admin, eventId);
  if (!row) throw new ActionError(BR.playInOpen, 'The play-in has not been closed yet');
  if (!row.state.bracket) throw new ActionError(BR.notDrawn, 'The bracket has not been drawn yet');
  return { ...row, bracket: row.state.bracket };
}

export function matchIn(bracket: Bracket, key: string): BracketMatch {
  const m = bracket.matches.find((x) => x.id === key);
  if (!m) throw new ActionError(BR.unknownMatch, `No match ${key} in this bracket`);
  return m;
}

export async function matchRow(admin: SupabaseClient, bracketId: string, key: string): Promise<BracketMatchRow> {
  const { data, error } = await admin.from('bracket_matches').select(BM_COLS).eq('bracket_id', bracketId).eq('match_key', key).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(BR.unknownMatch, `No match ${key} in this bracket`);
  return data as BracketMatchRow;
}

/** Write brackets.state only if nobody else wrote it since `row` was read (brackets.version, 0007). */
export async function saveState(admin: SupabaseClient, row: BracketRow, state: BracketState): Promise<void> {
  const { data, error } = await admin
    .from('brackets')
    .update({ state, version: row.version + 1 })
    .eq('id', row.id)
    .eq('version', row.version)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(BR.conflict, 'The bracket changed while saving; reload and try again');
}

export async function audit(admin: SupabaseClient, actor: string | null, entity: string, entityId: string, before: unknown, after: unknown) {
  const { error } = await admin.from('audit_log').insert({ actor_player_id: actor, entity, entity_id: entityId, before, after });
  if (error) throw new Error(error.message);
}

/**
 * Record the winner of a match from its signed card: matchStatus (via liveMatch: the
 * event's match_strokes, extra holes allowed, hole n > 18 played as tee hole ((n-1)%18)+1)
 * must be finished with a winner. Advances the winner (recordWinner), stores the result
 * label on bracket_matches and audits. Refuses a match that already has a winner.
 */
export async function finalizeMatchCore(
  admin: SupabaseClient,
  eventId: string,
  matchKey: string,
  actor: string | null,
): Promise<{ winnerId: string; result: string }> {
  const b = await drawnBracket(admin, eventId);
  const m = matchIn(b.bracket, matchKey);
  if (m.winner) throw new ActionError(BR.alreadyDecided, 'This match already has a winner');
  const bm = await matchRow(admin, b.id, matchKey);
  if (!bm.group_id) throw new ActionError(BR.noCard, 'This match has no scorecard yet');
  const { data: group, error } = await admin
    .from('groups')
    .select('id, round_id, start_hole, locked, signed_at')
    .eq('id', bm.group_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!group) throw new ActionError(BR.noCard, 'This match has no scorecard yet');
  const g = group as { id: string; round_id: string; start_hole: number; locked: boolean; signed_at: string | null };
  if (!g.locked) throw new ActionError(BR.cardUnsigned, 'Both players must sign the match card first');

  const card = await loadCard(admin, g);
  const live = liveMatch({ players: card.players, holes: card.holes, startHole: g.start_hole, matchStrokes: card.event.matchStrokes }, card.scores);
  if (!live || !live.state.finished || (live.state.winner !== 'A' && live.state.winner !== 'B')) {
    throw new ActionError(BR.undecided, 'The signed card does not decide the match');
  }
  const winnerId = card.players[live.state.winner === 'A' ? 0 : 1]!.id;
  if (winnerId !== m.a && winnerId !== m.b) throw new ActionError(BR.notInMatch, 'The card’s players are not this match’s players');
  const result = resultLabel(live.state);

  await saveState(admin, b, { ...b.state, bracket: recordWinner(b.bracket, matchKey, winnerId) });
  const { error: bmError } = await admin.from('bracket_matches').update({ result, forfeit: false }).eq('id', bm.id);
  if (bmError) throw new Error(bmError.message);
  await audit(admin, actor, 'bracket_match', bm.id, { winner: null, result: bm.result }, { action: 'finalize', match_key: matchKey, winner: winnerId, result });
  return { winnerId, result };
}

/** The bracket match a group is the card of, with its event, or null. */
async function matchOfGroup(admin: SupabaseClient, groupId: string): Promise<{ bm: BracketMatchRow; eventId: string } | null> {
  const { data, error } = await admin.from('bracket_matches').select(BM_COLS).eq('group_id', groupId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const bm = data as BracketMatchRow;
  const { data: br, error: brError } = await admin.from('brackets').select('event_id').eq('id', bm.bracket_id).maybeSingle();
  if (brError) throw new Error(brError.message);
  if (!br) return null;
  return { bm, eventId: (br as { event_id: string }).event_id };
}

/**
 * After a card locks: if it is a bracket match card, record the winner. Best effort: any
 * failure (already decided, undecided card, DB error) is swallowed, so a signature never
 * fails because of the bracket; finalizeMatch can be run again from the bracket pages.
 */
export async function finalizeForGroup(admin: SupabaseClient, groupId: string, actor: string | null): Promise<void> {
  try {
    const hit = await matchOfGroup(admin, groupId);
    if (!hit) return;
    await finalizeMatchCore(admin, hit.eventId, hit.bm.match_key, actor);
  } catch {
    // ignored on purpose (see above)
  }
}

/**
 * Before reopening a card. Not a bracket match card, or no winner recorded from it: nothing
 * to do. A winner already in a next match that has started (has a card or a result) blocks
 * the reopen ('next_match_started'). Otherwise returns a step to run after the reopen: it
 * clears the winner and result and takes the winner back out of the next match. A forfeit
 * result does not come from the card and is kept.
 */
export async function reopenBracketStep(admin: SupabaseClient, groupId: string): Promise<((actor: string) => Promise<void>) | null> {
  const hit = await matchOfGroup(admin, groupId);
  if (!hit || hit.bm.forfeit) return null;
  const b = await findBracket(admin, hit.eventId);
  const bracket = b?.state.bracket;
  if (!b || !bracket) return null;
  const m = bracket.matches.find((x) => x.id === hit.bm.match_key);
  if (!m || (!m.winner && hit.bm.result === null)) return null;
  if (m.winner) {
    const next = nextMatchOf(bracket, m);
    if (next) {
      const nextRow = await matchRow(admin, b.id, next.id);
      if (next.winner || nextRow.group_id) {
        throw new ActionError(SG.nextMatchStarted, `The winner already plays ${next.id}; reopen that match first`);
      }
    }
  }
  return async (actor: string) => {
    const fresh = await findBracket(admin, hit.eventId);
    if (!fresh?.state.bracket) return;
    const prior = fresh.state.bracket.matches.find((x) => x.id === hit.bm.match_key)?.winner ?? null;
    if (prior) await saveState(admin, fresh, { ...fresh.state, bracket: clearWinner(fresh.state.bracket, hit.bm.match_key) });
    const { error } = await admin.from('bracket_matches').update({ result: null }).eq('id', hit.bm.id);
    if (error) throw new Error(error.message);
    await audit(admin, actor, 'bracket_match', hit.bm.id, { winner: prior, result: hit.bm.result }, { action: 'reopen_clear', match_key: hit.bm.match_key, winner: null, result: null });
  };
}
