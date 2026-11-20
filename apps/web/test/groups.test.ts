import { describe, expect, it } from 'vitest';
import { pairGroups, suggestGroups } from '@/lib/groups';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const sizes = (n: number, size?: number) => suggestGroups(ids(n), size).map((g) => g.length);

describe('suggestGroups', () => {
  it('spreads the remainder so no group has fewer than 3 when avoidable', () => {
    expect(sizes(10)).toEqual([4, 3, 3]);
    expect(sizes(12)).toEqual([4, 4, 4]);
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(13)).toEqual([4, 3, 3, 3]);
    expect(sizes(4)).toEqual([4]);
    expect(sizes(0)).toEqual([]);
  });
  it('respects a custom size', () => {
    expect(sizes(9, 3)).toEqual([3, 3, 3]);
  });
  it('uses every player exactly once, in shuffled order from the rng', () => {
    const groups = suggestGroups(ids(10), 4, () => 0);
    expect(groups.flat().sort()).toEqual(ids(10).sort());
    const again = suggestGroups(ids(10), 4, () => 0);
    expect(again).toEqual(groups);
    expect(groups.flat()).not.toEqual(ids(10)); // rng 0 still permutes (Fisher-Yates)
  });
  it('does not mutate its input', () => {
    const input = ids(8);
    suggestGroups(input);
    expect(input).toEqual(ids(8));
  });
});

describe('pairGroups', () => {
  // index: lower is better; plus handicaps are negative; no index goes last
  const field = [
    { id: 'a', index: 12.4 },
    { id: 'b', index: -1.2 },
    { id: 'c', index: 5 },
    { id: 'd', index: null },
    { id: 'e', index: 20.1 },
    { id: 'f', index: 8.8 },
    { id: 'g', index: 3.3 },
    { id: 'h', index: 15 },
  ];

  it('by handicap: similar handicaps play together, lowest first', () => {
    expect(pairGroups(field, { method: 'handicap', size: 4 })).toEqual([
      ['b', 'g', 'c', 'f'],
      ['a', 'h', 'e', 'd'],
    ]);
  });

  it('balanced: each group gets a mix, snaking through the field', () => {
    // sorted: b g c f a h e d -> groups of 4 (2 groups): 1 2 2 1 1 2 2 1
    expect(pairGroups(field, { method: 'balanced', size: 4 })).toEqual([
      ['b', 'f', 'a', 'd'],
      ['g', 'c', 'h', 'e'],
    ]);
  });

  it('players per group: 3 makes groups of 3 (even sizes, larger first)', () => {
    expect(pairGroups(field, { method: 'handicap', size: 3 }).map((g) => g.length)).toEqual([3, 3, 2]);
    expect(pairGroups(field, { method: 'handicap', size: 2 }).map((g) => g.length)).toEqual([2, 2, 2, 2]);
  });

  it('random: every player once, same sizes as the other methods', () => {
    const groups = pairGroups(field, { method: 'random', size: 4 }, () => 0);
    expect(groups.map((g) => g.length)).toEqual([4, 4]);
    expect(groups.flat().sort()).toEqual(field.map((p) => p.id).sort());
  });
});
