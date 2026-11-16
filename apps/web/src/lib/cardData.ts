import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoleInfo } from '@hgt/scoring';
import { getTeeInfo } from '@/lib/courses';
import { ActionError } from '@/lib/actionResult';
import type { SignRole } from '@/lib/signingCodes';

export type CardRound = { id: string; event_id: string; round_number: number; tee_id: string; kind: 'stroke' | 'match' };
export type CardSignature = { role: SignRole; playerId: string; name: string; signedAt: string };

export type CardData = {
  round: CardRound;
  event: { name: string; handicapMode: 'gross' | 'net'; matchStrokes: 'full' | 'offLow' };
  /** Sorted by name. */
  players: { id: string; name: string; playingHandicap: number }[];
  holes: HoleInfo[];
  /**
   * Gross per player. Index i < holes.length is holes[i]; for match rounds the arrays
   * may run longer: index holes.length + k is extra hole 19 + k.
   */
  scores: Record<string, (number | null)[]>;
  signatures: CardSignature[];
};

const NOT_FOUND = 'not_found';

export async function roundOf(admin: SupabaseClient, roundId: string): Promise<CardRound> {
  const { data: round, error } = await admin
    .from('rounds')
    .select('id, event_id, round_number, tee_id, kind')
    .eq('id', roundId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!round) throw new ActionError(NOT_FOUND, 'Round not found');
  return round as CardRound;
}

/** Everything a scorecard shows, read with the service-role client. */
export async function loadCard(admin: SupabaseClient, group: { id: string; round_id: string }): Promise<CardData> {
  const round = await roundOf(admin, group.round_id);
  const [{ data: event, error: eventError }, { data: members, error: memberError }, tee, { data: rows, error: scoreError }, { data: sigs, error: sigError }] =
    await Promise.all([
      admin.from('events').select('name, handicap_mode, match_strokes').eq('id', round.event_id).maybeSingle(),
      admin.from('group_players').select('player_id, playing_handicap').eq('group_id', group.id),
      getTeeInfo(round.tee_id, admin),
      admin.from('scores').select('player_id, hole, gross').eq('group_id', group.id),
      admin.from('signatures').select('player_id, role, signed_at').eq('group_id', group.id),
    ]);
  if (eventError) throw new Error(eventError.message);
  if (memberError) throw new Error(memberError.message);
  if (scoreError) throw new Error(scoreError.message);
  if (sigError) throw new Error(sigError.message);
  if (!event) throw new ActionError(NOT_FOUND, 'Event not found');
  const ev = event as { name: string; handicap_mode: 'gross' | 'net' | null; match_strokes: 'full' | 'offLow' };

  const memberList = (members ?? []) as { player_id: string; playing_handicap: number | null }[];
  const sigList = (sigs ?? []) as { player_id: string; role: SignRole; signed_at: string }[];
  const ids = [...new Set([...memberList.map((m) => m.player_id), ...sigList.map((s) => s.player_id)])];
  const { data: people, error: peopleError } = ids.length
    ? await admin.from('players').select('id, name').in('id', ids)
    : { data: [], error: null };
  if (peopleError) throw new Error(peopleError.message);
  const nameOf = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const players = memberList
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

  const signatures = sigList
    .map((s) => ({ role: s.role, playerId: s.player_id, name: nameOf.get(s.player_id) ?? 'Player', signedAt: s.signed_at }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'scorer' ? -1 : 1));

  return {
    round,
    event: { name: ev.name, handicapMode: ev.handicap_mode ?? 'net', matchStrokes: ev.match_strokes },
    players,
    holes: tee.holes,
    scores,
    signatures,
  };
}
