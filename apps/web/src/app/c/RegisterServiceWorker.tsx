'use client';
import { useEffect } from 'react';

/** Same-origin /_next/static files this page loaded (scripts, styles, fonts), as absolute URLs. */
export function loadedStaticUrls(entries: { name: string }[], origin: string): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    try {
      const u = new URL(e.name, origin);
      if (u.origin === origin && u.pathname.startsWith('/_next/static/')) out.add(u.href);
    } catch {
      // not a URL
    }
  }
  return [...out];
}

/**
 * Registers /sw.js for the scorecard pages only (scope /c/), so a reload works offline. On a
 * /c/<code> page, once the worker is active, it also asks the worker to cache this page and the
 * /_next/static files it loaded: the first visit ran before the worker existed, so without this
 * a scorer would need a second online visit. (/c itself is outside the /c/ scope, so there is
 * nothing to cache or wait for there.)
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/c/' }).catch(() => {});
    if (!location.pathname.startsWith('/c/')) return;
    let cancelled = false;
    const send = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (cancelled || !reg.active) return;
        const urls = [
          location.origin + location.pathname + location.search,
          ...loadedStaticUrls(performance.getEntriesByType('resource'), location.origin),
        ];
        reg.active.postMessage({ type: 'cache-urls', urls });
      } catch {
        // no worker: the scorecard still works online
      }
    };
    if (document.readyState === 'complete') void send();
    else window.addEventListener('load', () => void send(), { once: true });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
