import { describe, expect, it } from 'vitest';
import { allRows } from '@/lib/allRows';

describe('allRows', () => {
  it('reads page after page until a short page (no silent 1000-row cut-off)', async () => {
    const data = Array.from({ length: 2345 }, (_, i) => i);
    const asked: [number, number][] = [];
    const rows = await allRows(async (from, to) => {
      asked.push([from, to]);
      return { data: data.slice(from, to + 1), error: null };
    });
    expect(rows).toHaveLength(2345);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('passes database errors on', async () => {
    await expect(allRows(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
  });
});
