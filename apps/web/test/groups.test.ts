import { describe, expect, it } from 'vitest';
import { suggestGroups } from '@/lib/groups';

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
