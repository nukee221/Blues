import type { HoleInfo } from '@hgt/scoring';
import { liveMatch } from '@/lib/scorecardView';
import { SG } from '@/lib/signingCodes';

export type CardForCompletion = {
  kind: 'stroke' | 'match';
  players: { id: string; name: string; playingHandicap: number }[];
  holes: HoleInfo[];
  /** Gross per player: index i < holes.length is holes[i]; extra hole 19 + k at holes.length + k. */
  scores: Record<string, (number | null)[]>;
  startHole: number;
  matchStrokes: 'full' | 'offLow';
};

export type Completion =
  | { complete: true }
  | { complete: false; code: typeof SG.incomplete | typeof SG.allSquare; message: string };

/**
 * Whether a card may be signed. Stroke: every player has a gross on every tee hole.
 * Match (two players): the match is decided, extra holes included; all square after 18
 * is not complete (play extra holes).
 */
export function cardCompletion(card: CardForCompletion): Completion {
  if (card.kind === 'match') {
    if (card.players.length !== 2) {
      return { complete: false, code: SG.incomplete, message: 'A match card needs exactly two players' };
    }
    const m = liveMatch(card, card.scores);
    if (m && m.state.finished && (m.state.winner === 'A' || m.state.winner === 'B')) return { complete: true };
    if (m && m.state.thru >= card.holes.length && m.state.up === 0) {
      return { complete: false, code: SG.allSquare, message: 'Match is all square — play extra holes' };
    }
    return { complete: false, code: SG.incomplete, message: 'The match is not finished yet' };
  }
  const full =
    card.players.length > 0 &&
    card.players.every((p) => card.holes.every((_, i) => card.scores[p.id]?.[i] != null));
  return full
    ? { complete: true }
    : { complete: false, code: SG.incomplete, message: `Every player needs a score on all ${card.holes.length} holes` };
}
