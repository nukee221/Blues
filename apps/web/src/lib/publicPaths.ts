/**
 * Paths reachable without a login. `/c` is the group-code scorecard (the code is the
 * credential); `/sw.js` is its offline service worker, fetched by anonymous scorers.
 */
export const PUBLIC_PREFIXES = ['/login', '/auth', '/forbidden', '/c', '/sw.js'];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
