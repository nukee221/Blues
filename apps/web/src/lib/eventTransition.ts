import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActionError } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { canTransition, type EventStatus } from '@/lib/eventStatus';

/**
 * The guarded, audited event status change shared by setEventStatus and finalizeEvent:
 * only allowed transitions (canTransition), the update conditional on the status read (a
 * concurrent change returns 'status_conflict'), and one audit row { status: from } ->
 * { status: to }. Service-role client; the caller has checked the commissioner.
 */
export async function transitionEventStatus(
  admin: SupabaseClient,
  actorPlayerId: string,
  eventId: string,
  to: EventStatus,
  /** Extra check on the status read, after canTransition (throw an ActionError to refuse). */
  guard?: (from: EventStatus) => void,
): Promise<{ from: EventStatus }> {
  const { data: current, error: readError } = await admin.from('events').select('id, status').eq('id', eventId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new ActionError(ACT.notFound, 'Event not found');
  const from = current.status as EventStatus;
  if (!canTransition(from, to)) throw new ActionError(ACT.invalidTransition, `Cannot move an event from ${from} to ${to}`);
  guard?.(from);

  // Guard on the status we read so a concurrent change cannot be overwritten.
  const { data: updated, error } = await admin
    .from('events')
    .update({ status: to })
    .eq('id', eventId)
    .eq('status', from)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new ActionError(ACT.statusConflict, 'Event status changed concurrently; reload and retry');

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_player_id: actorPlayerId,
    entity: 'event',
    entity_id: eventId,
    before: { status: from },
    after: { status: to },
  });
  if (auditError) throw new Error(auditError.message);
  return { from };
}
