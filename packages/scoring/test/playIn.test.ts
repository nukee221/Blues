import { describe, it, expect } from 'vitest';
import { advanceCount, playInCut, DEFAULT_PLAY_IN } from '../src/playIn';
import type { LeaderboardRow } from '../src/strokePlay';

const row = (playerId: string, position: number, tied: boolean): LeaderboardRow => ({
  playerId, thru: 18, gross: 80, net: 70, toPar: 0, position, tied,
});

describe('advanceCount', () => {
  it('uses the default rule', () => {
    expect(advanceCount(12)).toBe(6);
    expect(advanceCount(15)).toBe(6);
    expect(advanceCount(16)).toBe(8);
    expect(advanceCount(30)).toBe(8);
    expect(DEFAULT_PLAY_IN.threshold).toBe(16);
  });
  it('accepts a custom rule', () => {
    expect(advanceCount(10, { threshold: 10, below: 2, atOrAbove: 4 })).toBe(4);
  });
});

describe('playInCut', () => {
  it('advances all when no tie straddles the cut', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((p) => row(`p${p}`, p, false));
    const r = playInCut(rows, 6);
    expect(r.advanced).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(r.tiebreak).toBeNull();
  });
  it('sends a straddling tie group to tiebreak', () => {
    const rows = [
      row('p1', 1, false), row('p2', 2, false), row('p3', 3, false),
      row('p4', 4, false), row('p5', 5, false), row('p6', 6, true), row('p7', 6, true),
    ];
    const r = playInCut(rows, 6);
    expect(r.advanced).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(r.tiebreak).toEqual({ spots: 1, playerIds: ['p6', 'p7'] });
  });
  it('advances a tie group that fits exactly within the cut', () => {
    const rows = [row('a', 1, false), row('b', 2, true), row('c', 2, true), row('d', 4, false)];
    const r = playInCut(rows, 3);
    expect(r.advanced).toEqual(['a', 'b', 'c']);
    expect(r.tiebreak).toBeNull();
  });
  it('advances everyone when fewer rows than count', () => {
    const rows = [row('a', 1, false), row('b', 2, false)];
    expect(playInCut(rows, 6)).toEqual({ advanced: ['a', 'b'], tiebreak: null });
  });
});
