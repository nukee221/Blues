import { netScore, strokesOnHole } from './handicap';
import { rankWithTies } from './rank';
import type { TeeInfo } from './types';

export type PlayerCard = { playerId: string; playing: number; gross: (number | null)[] }; // index = hole-1
export type LeaderboardRow = {
  playerId: string;
  thru: number;
  gross: number;
  net: number;
  toPar: number;
  position: number;
  tied: boolean;
};

type Totals = Omit<LeaderboardRow, 'position' | 'tied'>;

function totals(card: PlayerCard, tee: TeeInfo, mode: 'gross' | 'net'): Totals {
  let thru = 0, gross = 0, net = 0, par = 0;
  for (const hole of tee.holes) {
    const g = card.gross[hole.number - 1];
    if (g === null || g === undefined) continue;
    thru += 1;
    gross += g;
    net += netScore(g, strokesOnHole(card.playing, hole.strokeIndex, tee.holes.length));
    par += hole.par;
  }
  return { playerId: card.playerId, thru, gross, net, toPar: (mode === 'net' ? net : gross) - par };
}

export function strokePlayLeaderboard(
  cards: PlayerCard[],
  tee: TeeInfo,
  mode: 'gross' | 'net',
): LeaderboardRow[] {
  const all = cards.map((c) => totals(c, tee, mode));
  const started = rankWithTies(all.filter((t) => t.thru > 0), (t) => t.toPar);
  const notStarted = all.filter((t) => t.thru === 0);
  const rows: LeaderboardRow[] = started.map((r) => ({ ...r.item, position: r.position, tied: r.tied }));
  const next = started.length + 1;
  for (const t of notStarted) rows.push({ ...t, position: next, tied: notStarted.length > 1 });
  return rows;
}
