'use server';
import { z } from 'zod';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { getMailer, type Mailer } from '@/lib/mailer';
import { sendReminderNow } from '@/lib/reminders';

const settingsSchema = z.object({
  eventId: z.string().uuid(),
  mode: z.enum(['auto', 'manual']),
  time: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, 'Pick a time on the quarter hour'),
});

type Admin = ReturnType<typeof createAdminClient>;
async function audit(admin: Admin, actor: string, entity: string, entityId: string, before: unknown, after: unknown) {
  const { error } = await admin.from('audit_log').insert({ actor_player_id: actor, entity, entity_id: entityId, before, after });
  if (error) throw new Error(error.message);
}

/** How an event's evening-before reminders go out: automatically at `time` (Central), or only by hand. */
export async function saveReminderSettings(input: { eventId: string; mode: 'auto' | 'manual'; time: string }): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const s = settingsSchema.parse(input);
    const admin = createAdminClient();
    const { data: before, error: bErr } = await admin.from('events').select('reminder_mode, reminder_time').eq('id', s.eventId).maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new ActionError(ACT.notFound, 'Event not found');
    const after = { reminder_mode: s.mode, reminder_time: `${s.time}:00` };
    const { error } = await admin.from('events').update(after).eq('id', s.eventId);
    if (error) throw new Error(error.message);
    await audit(admin, player.id, 'event', s.eventId, before, after);
    return null;
  });
}

/**
 * "Send reminder now" for one round. Already sent: refused with code `already_sent` unless
 * `resend` is true (the page asks first).
 */
export async function sendRoundReminderNow(roundId: string, resend = false, mailer?: Mailer): Promise<ActionResult<{ sent: number }>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = z.string().uuid().parse(roundId);
    const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
    if (!appUrl) throw new Error('APP_URL is not set');
    const admin = createAdminClient();
    let sent: number | null;
    try {
      // A browser cannot pass a mailer (functions do not cross the wire); tests can.
      const m = typeof mailer?.sendBatch === 'function' ? mailer : getMailer();
      sent = await sendReminderNow(admin, m, id, new Date(), appUrl, resend === true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'Round not found') throw new ActionError(ACT.notFound, 'Round not found');
      if (msg === 'This event is not open') throw new ActionError(ACT.wrongStatus, 'Reminders are for published or in-progress events');
      console.error('[sendRoundReminderNow] send failed', err);
      throw new ActionError(ACT.emailFailed, 'The reminder could not be sent. Try again in a minute.');
    }
    if (sent === null) throw new ActionError(ACT.alreadySent, 'This round’s reminder was already sent');
    await audit(admin, player.id, 'round', id, null, { reminder_sent: sent, resend: resend === true });
    return { sent };
  });
}
