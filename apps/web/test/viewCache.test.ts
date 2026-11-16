import { describe, expect, it, vi } from 'vitest';
import {
  fillScores,
  isNewer,
  loadCachedView,
  loadGroupView,
  pickNewer,
  saveCachedView,
  updateCachedCell,
  viewKey,
} from '@/lib/viewCache';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
const CODE = 'ABC234';
const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 15, min)).toISOString();
const view = (min: number, scores: Record<string, (number | null)[]> = { a: [null, null] }, n = min) => ({
  asOf: at(min),
  groupId: 'g',
  n,
  scores,
});

describe('view cache', () => {
  it('caches the live view under hgt_view_<code>', async () => {
    const s = memoryStorage();
    const v1 = view(1);
    await expect(loadGroupView(async () => ({ ok: true as const, data: v1 }), s, CODE)).resolves.toEqual({ source: 'live', view: v1 });
    expect(viewKey(CODE)).toBe('hgt_view_ABC234');
    expect(loadCachedView(s, CODE)).toEqual(v1);
  });

  it('never replaces a newer cached view with an older one (stale offline HTML render)', () => {
    const s = memoryStorage();
    expect(saveCachedView(s, CODE, view(30, { a: [4, 5] }))).toBe(true);
    expect(saveCachedView(s, CODE, view(10, { a: [null, null] }))).toBe(false);
    expect(loadCachedView(s, CODE)).toEqual(view(30, { a: [4, 5] }));
  });

  it('a newer view replaces the cache but keeps cells only the cache knew', () => {
    const s = memoryStorage();
    saveCachedView(s, CODE, view(10, { a: [4, null] }));
    saveCachedView(s, CODE, view(20, { a: [null, 6] }));
    expect(loadCachedView(s, CODE)).toEqual(view(20, { a: [4, 6] }));
  });

  it('records a locally entered score in the cached view without changing asOf', () => {
    const s = memoryStorage();
    saveCachedView(s, CODE, view(10));
    updateCachedCell(s, CODE, 'a', 1, 3);
    updateCachedCell(s, CODE, 'a', 18, 4); // extra hole slot grows the row
    const cached = loadCachedView<ReturnType<typeof view>>(s, CODE)!;
    expect(cached.asOf).toBe(at(10));
    expect(cached.scores.a![1]).toBe(3);
    expect(cached.scores.a![18]).toBe(4);
    updateCachedCell(s, CODE, 'nobody', 0, 4); // unknown player: ignored
    expect(Object.keys(loadCachedView<ReturnType<typeof view>>(s, CODE)!.scores)).toEqual(['a']);
  });

  it('compares and merges views', () => {
    expect(isNewer(view(2), view(1))).toBe(true);
    expect(isNewer(view(1), view(1))).toBe(false);
    expect(isNewer(view(1), null)).toBe(true);
    expect(pickNewer(view(1, undefined, 1), view(2, undefined, 2)).n).toBe(2);
    expect(pickNewer(view(3, undefined, 3), view(2, undefined, 2)).n).toBe(3);
    expect(pickNewer(view(3), null).n).toBe(3);
    expect(fillScores({ a: [null, 5], b: [1] }, { a: [4, 9, 7] })).toEqual({ a: [4, 5, 7], b: [1] });
  });

  it('falls back to the cached view when the call fails (offline), so scoring continues', async () => {
    const s = memoryStorage();
    saveCachedView(s, CODE, view(2));
    const offline = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadGroupView(offline, s, CODE)).resolves.toEqual({ source: 'cache', view: view(2) });
  });

  it('reports offline when nothing is cached', async () => {
    const s = memoryStorage();
    await expect(loadGroupView(async () => Promise.reject(new Error('down')), s, CODE)).resolves.toEqual({ source: 'offline' });
  });

  it('passes a returned failure through and forgets the view of an unknown code', async () => {
    const s = memoryStorage();
    saveCachedView(s, CODE, view(1));
    await expect(
      loadGroupView(async () => ({ ok: false as const, code: 'not_found', error: 'x' }), s, CODE),
    ).resolves.toMatchObject({ source: 'failed', code: 'not_found' });
    expect(loadCachedView(s, CODE)).toBeNull();
  });

  it('ignores a corrupt cache entry', () => {
    const s = memoryStorage();
    s.setItem(viewKey(CODE), '{oops');
    expect(loadCachedView(s, CODE)).toBeNull();
  });
});
