import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMailer } from '@/lib/mailer';
import { sendDueReminders } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Called every 15 minutes by the Supabase scheduler (pg_cron, set up in RUNBOOK part 3) with
 * `Authorization: Bearer <CRON_SECRET>`. Sends the automatic evening-before reminders that are due.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
  if (!appUrl) return new Response('APP_URL is not set', { status: 500 });
  return Response.json(await sendDueReminders(createAdminClient(), getMailer(), new Date(), appUrl));
}
