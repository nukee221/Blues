import type { ActionResult } from '@/lib/actionResult';

/**
 * Last good GroupView per code in localStorage (`hgt_view_<code>`), so a scorer who
 * reloads with no signal (page served by the service worker) keeps scoring from it.
 */
export const viewKey = (code: string) => `hgt_view_${code}`;

export function saveCachedView<T>(storage: Storage, code: string, view: T): void {
  try {
    storage.setItem(viewKey(code), JSON.stringify({ savedAt: Date.now(), view }));
  } catch {
    // full or blocked: the live view still works
  }
}

export function loadCachedView<T>(storage: Storage, code: string): T | null {
  try {
    const raw = storage.getItem(viewKey(code));
    const parsed = raw ? (JSON.parse(raw) as { view?: T }) : null;
    return parsed && typeof parsed === 'object' && parsed.view ? parsed.view : null;
  } catch {
    return null;
  }
}

export type LoadedView<T> =
  | { source: 'live'; view: T }
  | { source: 'cache'; view: T }
  | { source: 'offline' }
  | { source: 'failed'; code?: string; error: string };

/**
 * Fetch the view. Live result: cache and return it. The call itself failing (no network):
 * fall back to the cached view. A returned failure is passed on (and an unknown code
 * forgets the cached view).
 */
export async function loadGroupView<T>(
  fetcher: () => Promise<ActionResult<T>>,
  storage: Storage,
  code: string,
): Promise<LoadedView<T>> {
  let result: ActionResult<T>;
  try {
    result = await fetcher();
  } catch {
    const cached = loadCachedView<T>(storage, code);
    return cached ? { source: 'cache', view: cached } : { source: 'offline' };
  }
  if (result.ok) {
    saveCachedView(storage, code, result.data);
    return { source: 'live', view: result.data };
  }
  if (result.code === 'not_found') {
    try {
      storage.removeItem(viewKey(code));
    } catch {
      // ignore
    }
  }
  return { source: 'failed', code: result.code, error: result.error };
}
