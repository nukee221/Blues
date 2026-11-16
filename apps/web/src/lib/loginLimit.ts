/**
 * Small in-memory per-IP limiter for sign-in link requests (5 per 10 minutes). It is per server
 * instance (serverless instances do not share it), so it only blunts bursts; Supabase's own email
 * rate limit is the real backstop. The caller answers with the same neutral message either way.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX = 5;
const hits = new Map<string, number[]>();

/** Records a request; false when this IP is over the limit. Requests with no known IP are not limited. */
export function allowLoginRequest(ip: string | null, now = Date.now()): boolean {
  if (!ip) return true;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return true;
}

export function clientIp(h: Pick<Headers, 'get'>): string | null {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null;
}

export function resetLoginLimit() {
  hits.clear();
}
