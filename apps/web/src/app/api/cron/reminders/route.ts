import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMailer } from '@/lib/mailer';
import { isReminderHour, sendRoundReminders } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Called by the Vercel scheduler (vercel.json) at 23:00 and 00:00 UTC: one of the two is 6 PM
 * Central whatever the season, and only that one sends. Vercel signs the call with CRON_SECRET.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();
  if (!isReminderHour(now)) return Response.json({ skipped: 'not 6 PM Central' });
  const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
  if (!appUrl) return new Response('APP_URL is not set', { status: 500 });
  const result = await sendRoundReminders(createAdminClient(), getMailer(), now, appUrl);
  return Response.json(result);
}
