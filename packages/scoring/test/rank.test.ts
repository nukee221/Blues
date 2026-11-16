import { describe, expect, test } from 'vitest';
import { rankWithTies } from '../src/rank';

describe('rankWithTies', () => {
  test('equal scores share a position, next skips (1,2,2,4)', () => {
    const rows = rankWithTies([70, 72, 72, 75], (n) => n);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 2, 4]);
    expect(rows.map((r) => r.tied)).toEqual([false, true, true, false]);
  });
  test('sorts ascending and is stable among equals', () => {
    const rows = rankWithTies([{ id: 'a', s: 3 }, { id: 'b', s: 1 }, { id: 'c', s: 3 }], (x) => x.s);
    expect(rows.map((r) => r.item.id)).toEqual(['b', 'a', 'c']);
  });
  test('empty input', () => expect(rankWithTies([], (n: number) => n)).toEqual([]));
});
