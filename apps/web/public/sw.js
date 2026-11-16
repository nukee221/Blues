/* Scorecard service worker: lets a scorer reload /c/<code> with no signal.
 * Network-first (3 s timeout, then the cache) for /c/<code> page loads and same-origin
 * /_next/static/* assets. Nothing else is cached or intercepted (server actions,
 * API calls and other pages always go to the network). Registered with scope /c/.
 * The first visit happens before this worker controls the page, so the page also sends a
 * 'cache-urls' message (its own /c/<code> URL and the /_next/static files it loaded) and
 * one online visit is enough. Only a real scorecard document is stored (not the "no group has
 * that code" page, errors or redirects); /c/ documents are capped at the 20 most recent, and the
 * page's message also prunes /_next/static files of older builds. */
const CACHE = 'hgt-scorecard-v2';
const NETWORK_TIMEOUT_MS = 3000;
/** The scorecard page renders this attribute only when a group was found; the "no group has that code" page does not. */
const CARD_MARKER = 'data-hgt-card';
const MAX_DOCS = 20;

/** 'page' | 'static' | null — what to do with a request (exported for tests via self.hgtRoute). */
function route(url, method, mode, origin) {
  if (method !== 'GET') return null;
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return null;
  }
  if (u.origin !== origin) return null;
  // Scope is /c/, so only /c/<code> page loads reach this worker.
  if (mode === 'navigate' && u.pathname.startsWith('/c/')) return 'page';
  if (u.pathname.startsWith('/_next/static/')) return 'static';
  return null;
}
self.hgtRoute = route;

/** May the page ask this worker to cache `url`? Same origin, a /c/<code> document or a /_next/static file. */
function cacheable(url, origin) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return null;
  }
  if (u.origin !== origin) return null;
  if (u.pathname.startsWith('/_next/static/')) return u.href;
  if (u.pathname.startsWith('/c/') && u.pathname.length > 3) return u.origin + u.pathname + u.search;
  return null;
}
self.hgtCacheable = cacheable;

const MATCH = { ignoreSearch: false, ignoreVary: true };

const pathOf = (url) => new URL(url).pathname;

/** Only a good, direct answer is worth keeping: OK, not redirected, same origin, and for a /c/ document an actual scorecard. */
async function storable(url, response) {
  if (!response.ok || response.redirected || response.type !== 'basic') return false;
  if (pathOf(url).startsWith('/c/')) {
    const text = await response.clone().text();
    return text.indexOf(CARD_MARKER) !== -1;
  }
  return true;
}

async function put(cache, request, response) {
  if (!(await storable(typeof request === 'string' ? request : request.url, response))) return;
  await cache.put(request, response.clone());
  await capDocs(cache);
}

/** Keep the MAX_DOCS most recently written /c/ documents (Cache API keys come back oldest first). */
async function capDocs(cache) {
  const docs = (await cache.keys()).filter((r) => pathOf(r.url).startsWith('/c/'));
  await Promise.all(docs.slice(0, Math.max(0, docs.length - MAX_DOCS)).map((r) => cache.delete(r)));
}

/** Drop cached /_next/static files that the current build's page did not load (an older build). */
async function pruneStatic(cache, keep) {
  if (!keep.size) return;
  const stale = (await cache.keys()).filter((r) => pathOf(r.url).startsWith('/_next/static/') && !keep.has(r.url));
  await Promise.all(stale.map((r) => cache.delete(r)));
}

/** Network first; when the network is slow (lie-fi) or down, the cached copy. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, MATCH);
  const network = fetch(request).then(async (response) => {
    await put(cache, request, response);
    return response;
  });
  if (!cached) return network;
  network.catch(() => {}); // a late failure after the timeout is not an error
  return Promise.race([
    network.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS)),
  ]);
}

/** Fetch and store the given URLs (best effort, one failure does not stop the others). */
async function precache(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    urls.map(async (u) => {
      try {
        const response = await fetch(u, { credentials: 'same-origin' });
        await put(cache, u, response);
      } catch (e) {
        // offline or gone: the next online visit tries again
      }
    }),
  );
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hgt-scorecard-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .then((cache) => capDocs(cache))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const r = event.request;
  if (route(r.url, r.method, r.mode, self.location.origin)) event.respondWith(networkFirst(r));
});
self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || d.type !== 'cache-urls' || !Array.isArray(d.urls)) return;
  const urls = [...new Set(d.urls.slice(0, 200).map((u) => cacheable(String(u), self.location.origin)).filter(Boolean))];
  if (!urls.length) return;
  // The page lists the /_next/static files of the build it runs on, so anything else cached is an older build.
  const current = new Set(urls.filter((u) => pathOf(u).startsWith('/_next/static/')));
  event.waitUntil(precache(urls).then(() => caches.open(CACHE)).then((cache) => pruneStatic(cache, current)));
});
