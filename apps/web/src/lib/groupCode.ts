import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateGroupCode } from '@/lib/codes';
import { ActionError } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';

/**
 * Give a group a unique code (service-role client), retrying on a unique violation. Keeps a
 * code set concurrently: returns whatever code the group ends up with.
 */
export async function assignCode(admin: SupabaseClient, groupId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGroupCode();
    const { data, error } = await admin
      .from('groups')
      .update({ code })
      .eq('id', groupId)
      .is('code', null)
      .select('code')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') continue;
      throw new Error(error.message);
    }
    if (data) return (data as { code: string }).code;
    const { data: row, error: readError } = await admin.from('groups').select('code').eq('id', groupId).maybeSingle();
    if (readError) throw new Error(readError.message);
    const existing = (row as { code: string | null } | null)?.code;
    if (existing) return existing;
    throw new ActionError(ACT.notFound, 'Group disappeared while sending');
  }
  throw new ActionError(ACT.codeUnavailable, 'Could not generate a unique group code; try again');
}
