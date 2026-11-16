import { execSync } from 'node:child_process';
import { adminClient, supabaseEnv } from './support/env';

/** The rehearsal needs the seed and nothing else: no events, no linked accounts. */
export default async function globalSetup() {
  const admin = adminClient();
  const dirty = async () => {
    const { count: events } = await admin.from('events').select('id', { count: 'exact', head: true });
    const { count: linked } = await admin.from('players').select('id', { count: 'exact', head: true }).not('user_id', 'is', null);
    return (events ?? 0) > 0 || (linked ?? 0) > 0;
  };
  if (!(await dirty())) return;
  if (process.env.E2E_RESET === '1') {
    const host = new URL(supabaseEnv.url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`E2E_RESET=1 refuses to reset a database that is not local (Supabase URL host is ${host}).`);
    }
    execSync('npx -y supabase@2 db reset', {
      stdio: 'inherit',
      env: { ...process.env, SUPABASE_INTERNAL_IMAGE_REGISTRY: process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY ?? 'docker.io' },
    });
    if (!(await dirty())) return;
  }
  throw new Error('The local database has events or linked players from an earlier run. Run `npx -y supabase@2 db reset` (or set E2E_RESET=1) and try again.');
}
