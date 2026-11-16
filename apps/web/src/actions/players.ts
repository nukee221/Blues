'use server';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { handicapUpdatesSchema, playerSchema, type PlayerInput } from '@/lib/playerSchema';

/** Create or update a player. Refuses to remove the last commissioner. */
export async function savePlayer(input: PlayerInput): Promise<ActionResult<{ id: string }>> {
  await requireCommissioner();
  return toResult(async () => {
    const p = playerSchema.parse(input);
    const admin = createAdminClient();
    const fields = {
      name: p.name,
      email: p.email,
      handicap_index: Math.round(p.handicapIndex * 10) / 10,
      handicap_source: p.handicapSource,
      is_commissioner: p.isCommissioner,
    };

    if (p.id) {
      if (!p.isCommissioner) {
        const { data: current, error: curErr } = await admin
          .from('players')
          .select('is_commissioner')
          .eq('id', p.id)
          .maybeSingle();
        if (curErr) throw new Error(curErr.message);
        if (current?.is_commissioner) {
          const { count, error } = await admin
            .from('players')
            .select('id', { count: 'exact', head: true })
            .eq('is_commissioner', true)
            .neq('id', p.id);
          if (error) throw new Error(error.message);
          if (!count) throw new ActionError(ACT.lastCommissioner, 'Cannot remove the last commissioner');
        }
      }
      const { error } = await admin.from('players').update(fields).eq('id', p.id);
      if (error) throw new Error(error.message);
      return { id: p.id };
    }
    const { data, error } = await admin.from('players').insert(fields).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create player');
    return { id: data.id as string };
  });
}

/** Bulk-set handicap indexes (from the paste preview). */
export async function applyHandicapUpdates(
  updates: { playerId: string; index: number }[],
): Promise<ActionResult<{ updated: number }>> {
  await requireCommissioner();
  return toResult(async () => {
    const parsed = handicapUpdatesSchema.parse(updates);
    const admin = createAdminClient();
    for (const u of parsed) {
      const { error } = await admin
        .from('players')
        .update({ handicap_index: Math.round(u.index * 10) / 10 })
        .eq('id', u.playerId);
      if (error) throw new Error(error.message);
    }
    return { updated: parsed.length };
  });
}
