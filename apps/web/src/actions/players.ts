'use server';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { handicapUpdatesSchema, playerSchema, type PlayerInput } from '@/lib/playerSchema';

type Admin = ReturnType<typeof createAdminClient>;
const AUDIT_COLS = 'id, name, email, handicap_index, handicap_source, is_commissioner';
type PlayerAuditRow = {
  id: string;
  name: string;
  email: string;
  handicap_index: number | string | null;
  handicap_source: string | null;
  is_commissioner: boolean;
};
const auditView = (r: Omit<PlayerAuditRow, 'id'>) => ({
  name: r.name,
  email: r.email,
  handicap_index: r.handicap_index == null ? null : Number(r.handicap_index),
  handicap_source: r.handicap_source,
  is_commissioner: r.is_commissioner,
});

async function audit(admin: Admin, actor: string, playerId: string, before: unknown, after: unknown) {
  const { error } = await admin
    .from('audit_log')
    .insert({ actor_player_id: actor, entity: 'player', entity_id: playerId, before, after });
  if (error) throw new Error(error.message);
}

/** Create or update a player (audited, before/after). Refuses to remove the last commissioner. */
export async function savePlayer(input: PlayerInput): Promise<ActionResult<{ id: string }>> {
  const { player: actor } = await requireCommissioner();
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
      const { data: current, error: curErr } = await admin.from('players').select(AUDIT_COLS).eq('id', p.id).maybeSingle();
      if (curErr) throw new Error(curErr.message);
      if (!current) throw new ActionError(ACT.notFound, 'Player not found');
      if (!p.isCommissioner && current.is_commissioner) {
        const { count, error } = await admin
          .from('players')
          .select('id', { count: 'exact', head: true })
          .eq('is_commissioner', true)
          .neq('id', p.id);
        if (error) throw new Error(error.message);
        if (!count) throw new ActionError(ACT.lastCommissioner, 'Cannot remove the last commissioner');
      }
      const { error } = await admin.from('players').update(fields).eq('id', p.id);
      if (error) throw new Error(error.message);
      await audit(admin, actor.id, p.id, auditView(current as PlayerAuditRow), { ...auditView(fields), action: 'save_player' });
      return { id: p.id };
    }
    const { data, error } = await admin.from('players').insert(fields).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create player');
    await audit(admin, actor.id, data.id as string, null, { ...auditView(fields), action: 'create_player' });
    return { id: data.id as string };
  });
}

/** Bulk-set handicap indexes (from the paste preview); one audit row per player changed. */
export async function applyHandicapUpdates(
  updates: { playerId: string; index: number }[],
): Promise<ActionResult<{ updated: number }>> {
  const { player: actor } = await requireCommissioner();
  return toResult(async () => {
    const parsed = handicapUpdatesSchema.parse(updates);
    const admin = createAdminClient();
    const { data: rows, error: readErr } = await admin
      .from('players')
      .select(AUDIT_COLS)
      .in(
        'id',
        parsed.map((u) => u.playerId),
      );
    if (readErr) throw new Error(readErr.message);
    const before = new Map(((rows ?? []) as PlayerAuditRow[]).map((r) => [r.id, r]));
    for (const u of parsed) {
      const index = Math.round(u.index * 10) / 10;
      const { error } = await admin.from('players').update({ handicap_index: index }).eq('id', u.playerId);
      if (error) throw new Error(error.message);
      const prev = before.get(u.playerId);
      await audit(
        admin,
        actor.id,
        u.playerId,
        prev ? auditView(prev) : null,
        prev
          ? { ...auditView(prev), handicap_index: index, action: 'handicap_paste' }
          : { handicap_index: index, action: 'handicap_paste' },
      );
    }
    return { updated: parsed.length };
  });
}
