'use server';
import { z } from 'zod';
import { requireCommissioner, requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';

const idSchema = z.string().uuid();
const statusSchema = z.enum(['registered', 'withdrawn']);
type RegStatus = z.infer<typeof statusSchema>;

type EventRow = { id: string; status: string; registration_deadline: string | null };
type RegRow = { id: string; status: RegStatus };

/**
 * Self-service change as the signed-in player. The player's own client is used so RLS
 * (published + before deadline + own row) enforces the same rule; the explicit checks
 * here just give clear errors. Update-or-insert (no upsert): the column grant only
 * allows updating `status`.
 */
async function setOwn(eventId: string, status: RegStatus): Promise<ActionResult<null>> {
  const { player } = await requireUser();
  return toResult(async () => {
    idSchema.parse(eventId);
    const supabase = await createServerClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, status, registration_deadline')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    const ev = event as EventRow | null;
    if (!ev || ev.status === 'draft') throw new ActionError(ACT.notFound, 'Event not found');
    if (ev.status !== 'published' || !ev.registration_deadline || Date.now() >= new Date(ev.registration_deadline).getTime()) {
      throw new ActionError(ACT.registrationClosed, 'Registration is closed');
    }

    const { data: existing, error: readError } = await supabase
      .from('registrations')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('player_id', player.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const reg = existing as RegRow | null;

    if (reg) {
      if (reg.status === status) return null;
      const { error } = await supabase.from('registrations').update({ status }).eq('id', reg.id);
      if (error) throw new Error(error.message);
      return null;
    }
    if (status === 'withdrawn') return null; // nothing to withdraw
    const { error } = await supabase
      .from('registrations')
      .insert({ event_id: eventId, player_id: player.id, status: 'registered' });
    // A concurrent double-click already inserted the row: still registered.
    if (error && error.code !== '23505') throw new Error(error.message);
      return null;
  });
}

export async function register(eventId: string): Promise<ActionResult<null>> {
  return setOwn(eventId, 'registered');
}

export async function withdraw(eventId: string): Promise<ActionResult<null>> {
  return setOwn(eventId, 'withdrawn');
}

/** Commissioner adds/removes a player in any non-final status, even after close. Audited. */
export async function adminSetRegistration(eventId: string, playerId: string, status: RegStatus): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    idSchema.parse(eventId);
    idSchema.parse(playerId);
    statusSchema.parse(status);
    const admin = createAdminClient();

    const { data: event, error: eventError } = await admin
      .from('events')
      .select('id, status, registration_deadline')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!event) throw new ActionError(ACT.notFound, 'Event not found');
    if ((event as EventRow).status === 'final') throw new ActionError(ACT.eventFinal, 'Cannot change registrations on a final event');

    const { data: existing, error: readError } = await admin
      .from('registrations')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const reg = existing as RegRow | null;

    let regId: string;
    if (reg) {
      if (reg.status === status) return null;
      const { error } = await admin.from('registrations').update({ status }).eq('id', reg.id);
      if (error) throw new Error(error.message);
      regId = reg.id;
    } else {
      if (status === 'withdrawn') return null;
      const { data, error } = await admin
        .from('registrations')
        .insert({ event_id: eventId, player_id: playerId, status })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Could not add registration');
      regId = data.id as string;
    }

    const { error: auditError } = await admin.from('audit_log').insert({
      actor_player_id: player.id,
      entity: 'registration',
      entity_id: regId,
      before: reg ? { status: reg.status } : null,
      after: { event_id: eventId, player_id: playerId, status },
    });
    if (auditError) throw new Error(auditError.message);
    return null;
  });
}
