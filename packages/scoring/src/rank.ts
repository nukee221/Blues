import type { RankedRow } from './types';

/** Rank ascending by score; equal scores share a position (1,2,2,4). Stable. */
export function rankWithTies<T>(items: T[], score: (t: T) => number): RankedRow<T>[] {
  const scored = items.map((item, i) => ({ item, s: score(item), i }));
  scored.sort((x, y) => x.s - y.s || x.i - y.i);
  const rows: RankedRow<T>[] = [];
  scored.forEach((cur, idx) => {
    const prev = scored[idx - 1];
    const same = prev !== undefined && prev.s === cur.s;
    const position = same ? rows[idx - 1]!.position : idx + 1;
    if (same) rows[idx - 1]!.tied = true;
    rows.push({ item: cur.item, position, tied: same });
  });
  return rows;
}
