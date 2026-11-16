/**
 * The origin the browser used to reach the app. `request.url` is not reliable for this behind a
 * proxy or with `next start -H <host>` (it can say `localhost` while the browser is on 127.0.0.1),
 * and a redirect to the wrong host drops the session cookies that were just set.
 */
export function publicOrigin(request: Request, env: PublicEnv = currentEnv()): string {
  return originFromHeaders(request.headers, request.url, env);
}

type PublicEnv = { APP_URL?: string; NODE_ENV?: string };
const currentEnv = (): PublicEnv => ({ APP_URL: process.env.APP_URL, NODE_ENV: process.env.NODE_ENV });

/**
 * Host headers can be forged, so links and redirects use `APP_URL` whenever it is set; in
 * production it is required (throws if missing). Only outside production does a missing
 * `APP_URL` fall back to the request headers.
 */
export function configuredOrigin(env: PublicEnv = currentEnv()): string | null {
  const raw = env.APP_URL?.trim();
  if (raw) return new URL(raw).origin;
  if (env.NODE_ENV === 'production') throw new Error('APP_URL is not set');
  return null;
}

/** Same, from request headers alone (server actions); `fallbackUrl` when no host header is present. */
export function originFromHeaders(headers: Pick<Headers, 'get'>, fallbackUrl: string, env: PublicEnv = currentEnv()): string {
  const configured = configuredOrigin(env);
  if (configured) return configured;
  const url = new URL(fallbackUrl);
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  const host = first(headers.get('x-forwarded-host')) ?? first(headers.get('host'));
  if (!host) return url.origin;
  const proto = first(headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
