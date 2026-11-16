import type { ActionResult } from '@/lib/actionResult';

/**
 * Last good GroupView per code in localStorage (`hgt_view_<code>`), so a scorer who
 * reloads with no signal keeps scoring from it. Views carry the server's `asOf`; a view
 * never replaces a newer one. The page HTML a service worker serves offline holds an
 * OLD server render, so it must not clobber this cache.
 */
export const viewKey = (code: string) => `hgt_view_${code}`;

type Scores = Record<string, (number | null)[]>;
export type Versioned = { asOf: string; scores: Scores };

const asOfMs = (v: { asOf?: string } | null | undefined) => {
  const t = v?.asOf ? Date.parse(v.asOf) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/** True when `a` is strictly newer than `b`. */
export const isNewer = (a: { asOf?: string } | null | undefined, b: { asOf?: string } | null | undefined) => asOfMs(a) > asOfMs(b);

/** The newer of two views (the first on a tie or when one is missing). */
export function pickNewer<T extends Versioned>(a: T, b: T | null): T {
  return b && isNewer(b, a) ? b : a;
}

/**
 * Scores never get cleared in this app, so a known value is never replaced by a blank:
 * `primary` wins cell by cell, `secondary` fills its gaps (and its longer extra-hole rows).
 */
export function fillScores(primary: Scores, secondary: Scores): Scores {
  const out: Scores = {};
  for (const [pid, row] of Object.entries(primary)) {
    const other = secondary[pid] ?? [];
    const len = Math.max(row.length, other.length);
    out[pid] = Array.from({ length: len }, (_, i) => row[i] ?? other[i] ?? null);
  }
  return out;
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

function write(storage: Storage, code: string, view: unknown) {
  try {
    storage.setItem(viewKey(code), JSON.stringify({ view }));
  } catch {
    // full or blocked: the live view still works
  }
}

/**
 * Cache `view` unless the cached one is newer. Cells the cached copy knows and `view`
 * leaves blank are kept. Returns whether `view` was written.
 */
export function saveCachedView<T extends Versioned>(storage: Storage, code: string, view: T): boolean {
  const cached = loadCachedView<T>(storage, code);
  if (cached && isNewer(cached, view)) return false;
  write(storage, code, cached ? { ...view, scores: fillScores(view.scores, cached.scores ?? {}) } : view);
  return true;
}

/** Record a score this phone entered in the cached view (keeps its asOf). */
export function updateCachedCell(storage: Storage, code: string, playerId: string, slot: number, gross: number): void {
  const cached = loadCachedView<Versioned>(storage, code);
  if (!cached?.scores?.[playerId]) return;
  const row = [...cached.scores[playerId]!];
  while (row.length <= slot) row.push(null);
  row[slot] = gross;
  write(storage, code, { ...cached, scores: { ...cached.scores, [playerId]: row } });
}

export type LoadedView<T> =
  | { source: 'live'; view: T }
  | { source: 'cache'; view: T }
  | { source: 'offline' }
  | { source: 'failed'; code?: string; error: string };

/**
 * Fetch the view. Live result: cache it (unless the cache is newer) and return it. The
 * call itself failing (no network): fall back to the cached view. A returned failure is
 * passed on (and an unknown code forgets the cached view).
 */
export async function loadGroupView<T extends Versioned>(
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
