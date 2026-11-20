'use server';
import { z } from 'zod';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';

const ruleSchema = z.object({
  playerA: z.string().uuid(),
  playerB: z.string().uuid(),
  kind: z.enum(['together', 'apart']),
});

type Admin = ReturnType<typeof createAdminClient>;
async function audit(admin: Admin, actor: string, entityId: string, before: unknown, after: unknown) {
  const { error } = await admin.from('audit_log').insert({ actor_player_id: actor, entity: 'pairing_rule', entity_id: entityId, before, after });
  if (error) throw new Error(error.message);
}

/** Adds a tour-wide pairing rule; a rule already set for the same two players is replaced. */
export async function addPairingRule(input: { playerA: string; playerB: string; kind: 'together' | 'apart' }): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const r = ruleSchema.parse(input);
    if (r.playerA === r.playerB) throw new ActionError(ACT.samePlayer, 'Pick two different players');
    const [a, b] = [r.playerA, r.playerB].sort();
    const admin = createAdminClient();
    const { data: before } = await admin.from('pairing_rules').select('id, kind').eq('player_a', a!).eq('player_b', b!).maybeSingle();
    const { data: saved, error } = await admin
      .from('pairing_rules')
      .upsert({ player_a: a, player_b: b, kind: r.kind }, { onConflict: 'player_a,player_b' })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23503') throw new ActionError(ACT.notFound, 'Player not found');
      throw new Error(error.message);
    }
    await audit(admin, player.id, saved.id, before ?? null, { player_a: a, player_b: b, kind: r.kind });
    return null;
  });
}

export async function removePairingRule(ruleId: string): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = z.string().uuid().parse(ruleId);
    const admin = createAdminClient();
    const { data: before, error } = await admin.from('pairing_rules').delete().eq('id', id).select('player_a, player_b, kind').maybeSingle();
    if (error) throw new Error(error.message);
    if (!before) throw new ActionError(ACT.notFound, 'Rule not found');
    await audit(admin, player.id, id, before, null);
    return null;
  });
}
