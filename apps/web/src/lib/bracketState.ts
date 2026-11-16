import type { Bracket, BracketMatch, MatchState } from '@hgt/scoring';

/**
 * What brackets.state holds (0007): the play-in advancers, written when the play-in closes,
 * and the drawn Bracket (null until the draw).
 */
export type BracketState = { advanced: string[]; bracket: Bracket | null };

/** Stable failure codes of the bracket actions (clients and tests branch on these). */
export const BR = {
  invalid: 'invalid',
  notFound: 'not_found',
  notMatchPlay: 'not_match_play',
  wrongStatus: 'wrong_status',
  noGroups: 'no_groups',
  /** closePlayIn: some play-in card with a player still in is not signed. */
  cardsUnsigned: 'cards_unsigned',
  alreadyClosed: 'already_closed',
  notEnoughPlayers: 'not_enough_players',
  /** The play-in has not been closed yet (no advancers). */
  playInOpen: 'play_in_open',
  alreadyDrawn: 'already_drawn',
  notDrawn: 'not_drawn',
  unknownMatch: 'unknown_match',
  /** The match is a bye, or a player of it is not known yet. */
  notPlayable: 'not_playable',
  alreadyDecided: 'already_decided',
  notParticipant: 'not_participant',
  notInMatch: 'not_in_match',
  noCard: 'no_card',
  cardUnsigned: 'card_unsigned',
  /** The signed card does not decide the match (e.g. all square after 18). */
  undecided: 'match_undecided',
  noHandicap: 'no_handicap',
  /** The bracket changed while saving (another result was recorded); retry. */
  conflict: 'conflict',
} as const;

const MATCH_KEY = /^R\d{1,2}M\d{1,3}$/;
export const isMatchKey = (k: string) => MATCH_KEY.test(k);

/** brackets.state as stored; tolerates the legacy shape (a bare Bracket) and junk. */
export function parseState(raw: unknown): BracketState {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.matches)) return { advanced: [], bracket: o as unknown as Bracket };
  return {
    advanced: Array.isArray(o.advanced) ? (o.advanced as string[]) : [],
    bracket: o.bracket && typeof o.bracket === 'object' ? (o.bracket as Bracket) : null,
  };
}

/** The match the winner of `m` moves into (same rule as @hgt/scoring's recordWinner), or null after the final. */
export function nextMatchOf(bracket: Bracket, m: BracketMatch): BracketMatch | null {
  if (m.round >= bracket.rounds) return null;
  return bracket.matches.find((x) => x.round === m.round + 1 && x.slot === Math.ceil(m.slot / 2)) ?? null;
}

/** Undo a recorded winner: clears it and takes the player back out of the next match's slot. */
export function clearWinner(bracket: Bracket, matchId: string): Bracket {
  const copy: Bracket = { ...bracket, matches: bracket.matches.map((m) => ({ ...m })) };
  const m = copy.matches.find((x) => x.id === matchId);
  if (!m || m.winner === null || m.isBye) return copy;
  const next = nextMatchOf(copy, m);
  if (next) {
    if (m.slot % 2 === 1 && next.a === m.winner) next.a = null;
    if (m.slot % 2 === 0 && next.b === m.winner) next.b = null;
  }
  m.winner = null;
  return copy;
}

/**
 * The result stored on bracket_matches for a finished match: "3&2", "1 UP", or
 * "wins on 19th" for an extra-hole win (matchStatus's "A wins on 19th" without the side).
 */
export function resultLabel(state: MatchState): string {
  return state.label.replace(/^[AB] /, '');
}

/** Uniform in [0, 1) from the platform CSPRNG (Web Crypto). */
export function cryptoRng(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}
