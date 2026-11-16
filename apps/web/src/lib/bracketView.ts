import type { BracketMatch, MatchState } from '@hgt/scoring';
import { formatShortDate } from '@/lib/time';

export type MatchKind = 'bye' | 'waiting' | 'not_scheduled' | 'scheduled' | 'live' | 'final' | 'forfeit';

export type MatchCardInfo = {
  playDate: string | null;
  /** Any score entered. */
  scored: boolean;
  /** liveMatch of the card (names in the label), when scored. */
  live: { state: MatchState; label: string } | null;
};

/**
 * What a bracket match shows: "Bye", "TBD" (a player not known yet), "Not scheduled" (no
 * card), "Scheduled Mar 2", live "Alex 2 UP thru 12", a final result ("3&2") or "Forfeit".
 */
export function describeMatch(
  m: Pick<BracketMatch, 'a' | 'b' | 'winner' | 'isBye'>,
  row: { result: string | null; forfeit: boolean },
  card: MatchCardInfo | null,
): { kind: MatchKind; status: string } {
  if (m.isBye) return { kind: 'bye', status: 'Bye' };
  if (m.winner) return row.forfeit ? { kind: 'forfeit', status: 'Forfeit' } : { kind: 'final', status: row.result ?? 'Final' };
  if (!m.a || !m.b) return { kind: 'waiting', status: 'TBD' };
  if (!card) return { kind: 'not_scheduled', status: 'Not scheduled' };
  if (!card.scored || !card.live) {
    const d = formatShortDate(card.playDate);
    return { kind: 'scheduled', status: d ? `Scheduled ${d}` : 'Scheduled' };
  }
  return { kind: 'live', status: card.live.label };
}

/** "Final", "Semifinals", "Quarterfinals", else "Round n". */
export function roundName(round: number, rounds: number): string {
  if (round === rounds) return 'Final';
  if (round === rounds - 1) return 'Semifinals';
  if (round === rounds - 2) return 'Quarterfinals';
  return `Round ${round}`;
}
