/**
 * Paths reachable without a login. `/c` is the group-code scorecard (the code is the
 * credential); `/sw.js` is its offline service worker, fetched by anonymous scorers;
 * `/brand` is the tour artwork (logos), shown on the login page; `/api/cron` is the scheduler (checks CRON_SECRET itself).
 */
export const PUBLIC_PREFIXES = ['/login', '/auth', '/forbidden', '/c', '/sw.js', '/brand', '/api/cron'];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
