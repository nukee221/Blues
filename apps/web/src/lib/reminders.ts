import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailMessage, Mailer } from '@/lib/mailer';
import { renderReminderEmail, reminderSubject } from '@/emails/reminder';
import { centralToday } from '@/lib/home';
import { formatRoundDate, formatTeeTime, TOUR_TZ } from '@/lib/time';

/** Central wall-clock time now, as HH:MM. */
export function centralClock(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TOUR_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/** An automatic reminder is due once the Central clock reaches the event's time (HH:MM[:SS]). */
export function isDue(reminderTime: string, now: Date): boolean {
  return centralClock(now) >= reminderTime.slice(0, 5);
}

/** "R2M3" -> "Round 2, match 3". */
export function matchLabelOf(key: string): string {
  const m = key.match(/^R(\d+)M(\d+)$/);
  return m ? `Round ${m[1]}, match ${m[2]}` : 'Match';
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const OPEN = new Set(['published', 'registration_closed', 'in_progress']);

type RoundRow = { id: string; event_id: string; round_number: number; play_date: string | null; kind: string; tee_id: string; reminder_sent_at?: string | null };
type EventRow = { id: string; name: string; status: string; reminder_mode?: string | null; reminder_time?: string | null };

/**
 * The scheduled run (every 15 minutes): for rounds played tomorrow (Central) whose event sends
 * reminders automatically and whose time has come, email everyone playing, once per round.
 * Stroke rounds go to the field; a bracket match's round to its two players. Service-role client.
 */
export async function sendDueReminders(admin: SupabaseClient, mailer: Mailer, now: Date, appUrl: string): Promise<{ rounds: number; emails: number }> {
  const tomorrow = addDays(centralToday(now), 1);
  const { data: due, error } = await admin
    .from('rounds')
    .select('id, event_id, round_number, play_date, kind, tee_id')
    .eq('play_date', tomorrow)
    .in('kind', ['stroke', 'match'])
    .is('reminder_sent_at', null);
  if (error) throw new Error(error.message);
  let rounds = 0;
  let emails = 0;
  for (const round of (due ?? []) as RoundRow[]) {
    const { data: event } = await admin.from('events').select('id, name, status, reminder_mode, reminder_time').eq('id', round.event_id).maybeSingle();
    const ev = event as EventRow | null;
    if (!ev || !OPEN.has(ev.status) || (ev.reminder_mode ?? 'auto') !== 'auto' || !isDue(ev.reminder_time ?? '18:00', now)) continue;
    const sent = await sendRound(admin, mailer, round, ev, now, appUrl, false);
    if (sent) {
      rounds += 1;
      emails += sent;
    }
  }
  return { rounds, emails };
}

/**
 * A commissioner's "Send reminder now" for one round, any day. Resends only with `resend`
 * (the round already had its reminder). Returns the number of emails, or null when it was
 * already sent and `resend` is false (0: nobody to email). Throws if the round is not found or the event is not open.
 */
export async function sendReminderNow(admin: SupabaseClient, mailer: Mailer, roundId: string, now: Date, appUrl: string, resend: boolean): Promise<number | null> {
  const { data: round } = await admin.from('rounds').select('id, event_id, round_number, play_date, kind, tee_id, reminder_sent_at').eq('id', roundId).maybeSingle();
  if (!round) throw new Error('Round not found');
  const { data: event } = await admin.from('events').select('id, name, status').eq('id', (round as RoundRow).event_id).maybeSingle();
  if (!event || !OPEN.has((event as EventRow).status)) throw new Error('This event is not open');
  return sendRound(admin, mailer, round as RoundRow, event as EventRow, now, appUrl, resend);
}

/**
 * Claim the round (reminder_sent_at, so overlapping runs never double-send), email, and on a
 * failed send release the claim so it can be tried again. Returns the emails sent: 0 when there
 * is nobody to email (left unclaimed), null when it was already sent.
 */
async function sendRound(admin: SupabaseClient, mailer: Mailer, round: RoundRow, event: EventRow, now: Date, appUrl: string, resend: boolean): Promise<number | null> {
  // Nobody to email (no one registered yet, or a match already decided): leave it unclaimed.
  const messages = await buildMessages(admin, round, event, appUrl, now);
  if (messages.length === 0) return 0;
  const previous = round.reminder_sent_at ?? null;
  let claim = admin.from('rounds').update({ reminder_sent_at: now.toISOString() }).eq('id', round.id);
  claim = previous && resend ? claim.eq('reminder_sent_at', previous) : claim.is('reminder_sent_at', null);
  const { data: claimed, error } = await claim.select('id');
  if (error) throw new Error(error.message);
  if (!claimed || claimed.length === 0) return null;
  try {
    await mailer.sendBatch(messages);
    return messages.length;
  } catch (err) {
    await admin.from('rounds').update({ reminder_sent_at: previous }).eq('id', round.id);
    throw err;
  }
}

async function buildMessages(admin: SupabaseClient, round: RoundRow, event: EventRow, appUrl: string, now: Date): Promise<MailMessage[]> {
  const { data: tee } = await admin.from('tees').select('name, course_id').eq('id', round.tee_id).maybeSingle();
  const { data: course } = tee?.course_id ? await admin.from('courses').select('name').eq('id', tee.course_id).maybeSingle() : { data: null };
  const { data: groups } = await admin.from('groups').select('id, tee_time, start_hole, code').eq('round_id', round.id);
  const groupList = (groups ?? []) as { id: string; tee_time: string | null; start_hole: number; code: string | null }[];

  // A self-scheduled bracket match: its two players, unless the match is already decided.
  let matchLabel: string | null = null;
  if (round.kind === 'match') {
    if (groupList.length !== 1) return [];
    const { data: bm } = await admin.from('bracket_matches').select('match_key, result, forfeit').eq('group_id', groupList[0]!.id).maybeSingle();
    if (!bm || bm.result || bm.forfeit) return [];
    matchLabel = matchLabelOf(bm.match_key as string);
  }

  // Who plays: grouped (not withdrawn) players once groups exist, else everyone registered.
  let seats: { playerId: string; groupId: string | null }[];
  if (groupList.length) {
    const { data: gps } = await admin.from('group_players').select('group_id, player_id, withdrawn').in('group_id', groupList.map((g) => g.id));
    seats = ((gps ?? []) as { group_id: string; player_id: string; withdrawn: boolean | null }[])
      .filter((g) => !g.withdrawn)
      .map((g) => ({ playerId: g.player_id, groupId: g.group_id }));
  } else if (round.kind === 'match') {
    return [];
  } else {
    const { data: regs } = await admin.from('registrations').select('player_id').eq('event_id', event.id).eq('status', 'registered');
    seats = ((regs ?? []) as { player_id: string }[]).map((r) => ({ playerId: r.player_id, groupId: null }));
  }
  if (seats.length === 0) return [];
  const { data: people } = await admin.from('players').select('id, name, email').in('id', seats.map((s) => s.playerId));
  const personOf = new Map(((people ?? []) as { id: string; name: string; email: string }[]).map((p) => [p.id, p]));
  const eventUrl = `${appUrl}/events/${event.id}`;
  const roundDate = formatRoundDate(round.play_date ?? null);
  const today = centralToday(now);
  const when = round.play_date === today ? 'today' : round.play_date === addDays(today, 1) ? 'tomorrow' : 'soon';

  return seats.flatMap((s) => {
    const p = personOf.get(s.playerId);
    if (!p?.email) return [];
    const g = groupList.find((x) => x.id === s.groupId);
    const mates = g ? seats.filter((x) => x.groupId === g.id && x.playerId !== p.id).map((x) => personOf.get(x.playerId)?.name ?? 'Player') : [];
    const opponentName = matchLabel ? (mates[0] ?? null) : null;
    return [
      {
        to: p.email,
        subject: reminderSubject({ eventName: event.name, roundNumber: round.round_number, when, opponentName }),
        html: renderReminderEmail({
          playerName: p.name,
          eventName: event.name,
          roundNumber: round.round_number,
          roundDate,
          courseName: (course?.name as string | undefined) ?? null,
          teeName: (tee?.name as string | undefined) ?? null,
          teeTime: g && !matchLabel ? formatTeeTime(round.play_date ?? null, g.tee_time) : null,
          startHole: g?.start_hole ?? null,
          groupMates: matchLabel ? [] : mates,
          matchLabel,
          opponentName,
          scorecardUrl: g?.code ? `${appUrl}/c/${g.code}` : null,
          eventUrl,
          appUrl,
          when,
        }),
      },
    ];
  });
}
