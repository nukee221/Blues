/* Scorecard service worker: lets a scorer reload /c/<code> with no signal.
 * Network-first with cache fallback for /c/* page loads and same-origin
 * /_next/static/* assets. Nothing else is cached or intercepted (server actions,
 * API calls and other pages always go to the network). Registered with scope /c/. */
const CACHE = 'hgt-scorecard-v1';

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
  if (mode === 'navigate' && (u.pathname === '/c' || u.pathname.startsWith('/c/'))) return 'page';
  if (u.pathname.startsWith('/_next/static/')) return 'static';
  return null;
}
self.hgtRoute = route;

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hgt-scorecard-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const r = event.request;
  if (route(r.url, r.method, r.mode, self.location.origin)) event.respondWith(networkFirst(r));
});
