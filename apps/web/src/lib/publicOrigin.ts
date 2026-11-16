/**
 * The origin the browser used to reach the app. `request.url` is not reliable for this behind a
 * proxy or with `next start -H <host>` (it can say `localhost` while the browser is on 127.0.0.1),
 * and a redirect to the wrong host drops the session cookies that were just set.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  const host = first(request.headers.get('x-forwarded-host')) ?? first(request.headers.get('host'));
  if (!host) return url.origin;
  const proto = first(request.headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
