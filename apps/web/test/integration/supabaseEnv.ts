import { execSync } from 'node:child_process';

export type LocalSupabase = { url: string; anonKey: string; serviceKey: string };

/** URL/keys from env vars if set, else from `supabase status -o env` (local stack must be running). */
export function localSupabase(): LocalSupabase {
  const e = process.env;
  if (e.SUPABASE_URL && e.SUPABASE_ANON_KEY && e.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: e.SUPABASE_URL, anonKey: e.SUPABASE_ANON_KEY, serviceKey: e.SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execSync('npx -y supabase@2 status -o env', {
    env: { ...process.env, SUPABASE_INTERNAL_IMAGE_REGISTRY: process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY ?? 'docker.io' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const vars: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) vars[m[1]!] = m[2]!;
  }
  const url = vars.API_URL;
  const anonKey = vars.ANON_KEY;
  const serviceKey = vars.SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('Local Supabase is not running (supabase status gave no keys)');
  return { url, anonKey, serviceKey };
}
