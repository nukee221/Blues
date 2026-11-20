import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailMessage, Mailer } from '@/lib/mailer';
import { renderReminderEmail, reminderSubject } from '@/emails/reminder';
import { centralToday } from '@/lib/home';
import { formatRoundDate, formatTeeTime, TOUR_TZ } from '@/lib/time';

/** Reminders go out at 6 PM Central (any minute of that hour: the scheduler may run late). */
export const REMINDER_HOUR = 18;

export function isReminderHour(now: Date): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TOUR_TZ, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h === REMINDER_HOUR;
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const OPEN = new Set(['published', 'registration_closed', 'in_progress']);

type RoundRow = { id: string; event_id: string; round_number: number; play_date: string; kind: string; tee_id: string };

/**
 * Email everyone playing a round tomorrow (Central): the grouped players once the tee sheet is
 * out (with tee time, start hole and scorecard), otherwise every registered player. Stroke
 * rounds only (bracket matches have their own reminder). Each round is claimed by setting
 * reminder_sent_at before sending, so overlapping runs never double-send; a failed send clears
 * it again so the next run retries. Service-role client.
 */
export async function sendRoundReminders(admin: SupabaseClient, mailer: Mailer, now: Date, appUrl: string): Promise<{ rounds: number; emails: number }> {
  const tomorrow = addDays(centralToday(now), 1);
  const { data: due, error } = await admin
    .from('rounds')
    .select('id, event_id, round_number, play_date, kind, tee_id')
    .eq('play_date', tomorrow)
    .eq('kind', 'stroke')
    .is('reminder_sent_at', null);
  if (error) throw new Error(error.message);
  let rounds = 0;
  let emails = 0;
  for (const round of (due ?? []) as RoundRow[]) {
    const { data: event } = await admin.from('events').select('id, name, status').eq('id', round.event_id).maybeSingle();
    if (!event || !OPEN.has(event.status as string)) continue;

    const { data: claimed, error: cErr } = await admin
      .from('rounds')
      .update({ reminder_sent_at: now.toISOString() })
      .eq('id', round.id)
      .is('reminder_sent_at', null)
      .select('id');
    if (cErr) throw new Error(cErr.message);
    if (!claimed || claimed.length === 0) continue; // another run took it

    try {
      const messages = await buildMessages(admin, round, event as { id: string; name: string }, appUrl);
      if (messages.length) await mailer.sendBatch(messages);
      rounds += 1;
      emails += messages.length;
    } catch (err) {
      await admin.from('rounds').update({ reminder_sent_at: null }).eq('id', round.id);
      throw err;
    }
  }
  return { rounds, emails };
}

async function buildMessages(admin: SupabaseClient, round: RoundRow, event: { id: string; name: string }, appUrl: string): Promise<MailMessage[]> {
  const { data: tee } = await admin.from('tees').select('name, course_id').eq('id', round.tee_id).maybeSingle();
  const { data: course } = tee?.course_id ? await admin.from('courses').select('name').eq('id', tee.course_id).maybeSingle() : { data: null };
  const { data: groups } = await admin.from('groups').select('id, tee_time, start_hole, code').eq('round_id', round.id);
  const groupList = (groups ?? []) as { id: string; tee_time: string | null; start_hole: number; code: string | null }[];

  // Who plays: grouped (not withdrawn) players once groups exist, else everyone registered.
  let seats: { playerId: string; groupId: string | null }[];
  if (groupList.length) {
    const { data: gps } = await admin.from('group_players').select('group_id, player_id, withdrawn').in('group_id', groupList.map((g) => g.id));
    seats = ((gps ?? []) as { group_id: string; player_id: string; withdrawn: boolean | null }[])
      .filter((g) => !g.withdrawn)
      .map((g) => ({ playerId: g.player_id, groupId: g.group_id }));
  } else {
    const { data: regs } = await admin.from('registrations').select('player_id').eq('event_id', event.id).eq('status', 'registered');
    seats = ((regs ?? []) as { player_id: string }[]).map((r) => ({ playerId: r.player_id, groupId: null }));
  }
  if (seats.length === 0) return [];
  const { data: people } = await admin.from('players').select('id, name, email').in('id', seats.map((s) => s.playerId));
  const personOf = new Map(((people ?? []) as { id: string; name: string; email: string }[]).map((p) => [p.id, p]));
  const eventUrl = `${appUrl}/events/${event.id}`;
  const roundDate = formatRoundDate(round.play_date);

  return seats.flatMap((s) => {
    const p = personOf.get(s.playerId);
    if (!p?.email) return [];
    const g = groupList.find((x) => x.id === s.groupId);
    const mates = g ? seats.filter((x) => x.groupId === g.id && x.playerId !== p.id).map((x) => personOf.get(x.playerId)?.name ?? 'Player') : [];
    return [
      {
        to: p.email,
        subject: reminderSubject({ eventName: event.name, roundNumber: round.round_number }),
        html: renderReminderEmail({
          playerName: p.name,
          eventName: event.name,
          roundNumber: round.round_number,
          roundDate,
          courseName: (course?.name as string | undefined) ?? null,
          teeName: (tee?.name as string | undefined) ?? null,
          teeTime: g ? formatTeeTime(round.play_date, g.tee_time) : null,
          startHole: g?.start_hole ?? null,
          groupMates: mates,
          scorecardUrl: g?.code ? `${appUrl}/c/${g.code}` : null,
          eventUrl,
          appUrl,
        }),
      },
    ];
  });
}
