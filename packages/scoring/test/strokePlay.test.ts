import { describe, expect, test } from 'vitest';
import { strokePlayLeaderboard, type PlayerCard } from '../src/strokePlay';
import type { TeeInfo } from '../src/types';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
holes[0]!.par = 5; holes[1]!.par = 5; holes[2]!.par = 3; holes[3]!.par = 3; // par 72
const tee: TeeInfo = { rating: 72, slope: 113, par: 72, holes };

/** Gross card = par + delta on the first n holes (n = delta count of +1s), par elsewhere. */
function card(playerId: string, playing: number, overPar: number, thru = 18): PlayerCard {
  const gross = holes.map((h, i) => (i < thru ? h.par + (i < overPar ? 1 : 0) : null));
  return { playerId, playing, gross };
}

describe('strokePlayLeaderboard', () => {
  const a = card('A', 10, 8); // gross 80, net 70
  const b = card('B', 2, 3); // gross 75, net 73

  test('net mode: A (70) beats B (73)', () => {
    const lb = strokePlayLeaderboard([b, a], tee, 'net');
    expect(lb.map((r) => r.playerId)).toEqual(['A', 'B']);
    expect(lb[0]).toMatchObject({ gross: 80, net: 70, toPar: -2, thru: 18, position: 1, tied: false });
  });
  test('gross mode: B first', () => {
    const lb = strokePlayLeaderboard([a, b], tee, 'gross');
    expect(lb.map((r) => r.playerId)).toEqual(['B', 'A']);
    expect(lb[0]).toMatchObject({ gross: 75, toPar: 3 });
  });
  test('mid-round +1 thru 9 ranks above complete +3', () => {
    const mid = card('M', 0, 1, 9);
    const full = card('F', 0, 3);
    const lb = strokePlayLeaderboard([full, mid], tee, 'gross');
    expect(lb.map((r) => r.playerId)).toEqual(['M', 'F']);
    expect(lb[0]).toMatchObject({ thru: 9, toPar: 1 });
  });
  test('card with no scores is last with thru 0', () => {
    const none: PlayerCard = { playerId: 'N', playing: 5, gross: Array(18).fill(null) };
    const lb = strokePlayLeaderboard([none, a], tee, 'net');
    expect(lb.map((r) => r.playerId)).toEqual(['A', 'N']);
    expect(lb[1]).toMatchObject({ thru: 0, gross: 0, net: 0, toPar: 0, position: 2, tied: false });
  });
  test('several unstarted cards share the next position, tied', () => {
    const n1: PlayerCard = { playerId: 'N1', playing: 0, gross: Array(18).fill(null) };
    const n2: PlayerCard = { playerId: 'N2', playing: 0, gross: Array(18).fill(null) };
    const lb = strokePlayLeaderboard([n1, a, n2], tee, 'net');
    expect(lb.map((r) => [r.playerId, r.position, r.tied])).toEqual([['A', 1, false], ['N1', 2, true], ['N2', 2, true]]);
  });
});
