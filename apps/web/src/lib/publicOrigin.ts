/**
 * The origin the browser used to reach the app. `request.url` is not reliable for this behind a
 * proxy or with `next start -H <host>` (it can say `localhost` while the browser is on 127.0.0.1),
 * and a redirect to the wrong host drops the session cookies that were just set.
 */
export function publicOrigin(request: Request): string {
  return originFromHeaders(request.headers, request.url);
}

/** Same, from request headers alone (server actions); `fallbackUrl` when no host header is present. */
export function originFromHeaders(headers: Pick<Headers, 'get'>, fallbackUrl: string): string {
  const url = new URL(fallbackUrl);
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  const host = first(headers.get('x-forwarded-host')) ?? first(headers.get('host'));
  if (!host) return url.origin;
  const proto = first(headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
