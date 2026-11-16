import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localSupabase } from '../../test/integration/supabaseEnv';

export const supabaseEnv = localSupabase();

/** Service-role client: the test's "behind the scenes" hand (seeding, reading codes, service-path scoring). */
export function adminClient(): SupabaseClient {
  return createClient(supabaseEnv.url, supabaseEnv.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
