import { describe, expect, it, vi } from 'vitest';
import { loadCachedView, loadGroupView, saveCachedView, viewKey } from '@/lib/viewCache';

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
const v1 = { groupId: 'g', isScorerDevice: true, n: 1 };
const v2 = { groupId: 'g', isScorerDevice: true, n: 2 };

describe('view cache', () => {
  it('caches the live view under hgt_view_<code>', async () => {
    const s = memoryStorage();
    await expect(loadGroupView(async () => ({ ok: true as const, data: v1 }), s, CODE)).resolves.toEqual({ source: 'live', view: v1 });
    expect(viewKey(CODE)).toBe('hgt_view_ABC234');
    expect(loadCachedView(s, CODE)).toEqual(v1);
  });

  it('falls back to the cached view when the call fails (offline), so scoring continues', async () => {
    const s = memoryStorage();
    saveCachedView(s, CODE, v2);
    const offline = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadGroupView(offline, s, CODE)).resolves.toEqual({ source: 'cache', view: v2 });
  });

  it('reports offline when nothing is cached', async () => {
    const s = memoryStorage();
    await expect(loadGroupView(async () => Promise.reject(new Error('down')), s, CODE)).resolves.toEqual({ source: 'offline' });
  });

  it('passes a returned failure through and forgets the view of an unknown code', async () => {
    const s = memoryStorage();
    saveCachedView(s, CODE, v1);
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
