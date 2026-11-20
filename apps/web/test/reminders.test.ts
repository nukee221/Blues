import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeDb } from './fakeDb';
import { createFakeMailer } from '@/lib/mailer';
import { addDays, isDue, sendDueReminders, sendReminderNow } from '@/lib/reminders';

const E = 'e1';
const P = ['p1', 'p2', 'p3', 'p4'];
let db: ReturnType<typeof createFakeDb>;

function seed(over: { status?: string; playDate?: string; kind?: string; grouped?: boolean; sent?: string | null; mode?: string; time?: string } = {}) {
  db = createFakeDb({
    events: [{ id: E, name: 'Masters 2027', status: over.status ?? 'in_progress', handicap_mode: 'net', reminder_mode: over.mode ?? 'auto', reminder_time: over.time ?? '18:00:00' }],
    rounds: [
      { id: 'r1', event_id: E, round_number: 1, play_date: over.playDate ?? '2027-04-10', kind: over.kind ?? 'stroke', tee_id: 't1', reminder_sent_at: over.sent ?? null },
      { id: 'r2', event_id: E, round_number: 2, play_date: '2027-04-11', kind: 'stroke', tee_id: 't1', reminder_sent_at: null },
    ],
    tees: [{ id: 't1', name: 'White', course_id: 'c1' }],
    courses: [{ id: 'c1', name: 'Cherokee Ridge' }],
    players: P.map((id, i) => ({ id, name: `Player ${i + 1}`, email: `p${i + 1}@example.test` })),
    registrations: P.map((id, i) => ({ id: `reg${i}`, event_id: E, player_id: id, status: i === 3 ? 'withdrawn' : 'registered' })),
    groups: over.grouped ? [{ id: 'g1', round_id: 'r1', tee_time: '08:10', start_hole: 1, code: 'K7MPQ3' }, { id: 'g2', round_id: 'r1', tee_time: '08:20', start_hole: 10, code: 'ABC234' }] : [],
    group_players: over.grouped
      ? [
          { id: 'gp1', group_id: 'g1', player_id: 'p1', withdrawn: false },
          { id: 'gp2', group_id: 'g1', player_id: 'p2', withdrawn: false },
          { id: 'gp3', group_id: 'g2', player_id: 'p3', withdrawn: false },
        ]
      : [],
  });
}

// 2027-04-09 18:05 CDT = 23:05 UTC.
const SIX_PM_CDT = new Date('2027-04-09T23:05:00Z');
const APP = 'https://tour.example.test';

beforeEach(() => seed());

describe('isDue / addDays', () => {
  it("is due once the Central clock reaches the event's time, summer and winter", () => {
    expect(isDue('18:00:00', new Date('2027-07-01T23:00:00Z'))).toBe(true); // 6:00 PM CDT
    expect(isDue('18:00', new Date('2027-07-01T22:59:00Z'))).toBe(false); // 5:59 PM CDT
    expect(isDue('19:30', new Date('2027-07-02T00:20:00Z'))).toBe(false); // 7:20 PM CDT
    expect(isDue('19:30', new Date('2027-07-02T00:30:00Z'))).toBe(true); // 7:30 PM CDT
    expect(isDue('18:00', new Date('2027-01-11T00:10:00Z'))).toBe(true); // 6:10 PM CST
    expect(isDue('18:00', new Date('2027-01-10T23:10:00Z'))).toBe(false); // 5:10 PM CST
  });
  it('adds days to a calendar date', () => {
    expect(addDays('2027-04-09', 1)).toBe('2027-04-10');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
  });
});

describe('sendRoundReminders', () => {
  it('before groups: emails every registered player about tomorrow’s round, once', async () => {
    const mailer = createFakeMailer();
    expect(await sendDueReminders(db as never, mailer, SIX_PM_CDT, APP)).toEqual({ rounds: 1, emails: 3 });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['p1@example.test', 'p2@example.test', 'p3@example.test']);
    expect(mailer.sent[0]!.subject).toBe('Tomorrow: Masters 2027, round 1');
    expect(mailer.sent[0]!.html).toContain('Cherokee Ridge');
    expect(mailer.sent[0]!.html).toContain(`${APP}/events/${E}`);
    expect(db.tables.rounds!.find((r) => r.id === 'r1')!.reminder_sent_at).toBeTruthy();
    expect(db.tables.rounds!.find((r) => r.id === 'r2')!.reminder_sent_at).toBeNull();
    // A second run the same evening sends nothing.
    const again = createFakeMailer();
    expect(await sendDueReminders(db as never, again, SIX_PM_CDT, APP)).toEqual({ rounds: 0, emails: 0 });
  });
  it('with groups: emails the grouped players their tee time, start hole and scorecard link', async () => {
    seed({ grouped: true });
    const mailer = createFakeMailer();
    expect(await sendDueReminders(db as never, mailer, SIX_PM_CDT, APP)).toEqual({ rounds: 1, emails: 3 });
    const p1 = mailer.sent.find((m) => m.to === 'p1@example.test')!;
    expect(p1.html).toContain('8:10 AM CDT');
    expect(p1.html).toContain('Hole 1');
    expect(p1.html).toContain(`${APP}/c/K7MPQ3`);
    expect(p1.html).toContain('Player 2');
    const p3 = mailer.sent.find((m) => m.to === 'p3@example.test')!;
    expect(p3.html).toContain('8:20 AM CDT');
    expect(p3.html).toContain('Hole 10');
  });
  it('skips other days, a match round with no card, drafts, finished events, manual events, and before the chosen time', async () => {
    for (const over of [{ playDate: '2027-04-12' }, { kind: 'match' }, { status: 'draft' }, { status: 'final' }, { mode: 'manual' }, { time: '19:00:00' }]) {
      seed(over);
      const mailer = createFakeMailer();
      expect(await sendDueReminders(db as never, mailer, SIX_PM_CDT, APP)).toEqual({ rounds: 0, emails: 0 });
    }
  });
  it('if sending fails, the round is not marked, so the next run tries again', async () => {
    const failing = { ...createFakeMailer(), sendBatch: async () => { throw new Error('down'); } };
    await expect(sendDueReminders(db as never, failing, SIX_PM_CDT, APP)).rejects.toThrow(/down/);
    expect(db.tables.rounds!.find((r) => r.id === 'r1')!.reminder_sent_at).toBeNull();
  });
});

describe('sendReminderNow (commissioner button)', () => {
  it('sends a manual event’s reminder whenever asked, days ahead too, and says when', async () => {
    seed({ mode: 'manual' });
    const mailer = createFakeMailer();
    expect(await sendReminderNow(db as never, mailer, 'r1', new Date('2027-04-07T15:00:00Z'), APP, false)).toBe(3);
    expect(mailer.sent[0]!.subject).toBe('Coming up: Masters 2027, round 1');
    expect(db.tables.rounds!.find((r) => r.id === 'r1')!.reminder_sent_at).toBeTruthy();
  });
  it('the day of the round says today', async () => {
    const mailer = createFakeMailer();
    await sendReminderNow(db as never, mailer, 'r1', new Date('2027-04-10T12:00:00Z'), APP, false);
    expect(mailer.sent[0]!.subject).toBe('Today: Masters 2027, round 1');
  });
  it('already sent: nothing unless resend is asked for', async () => {
    seed({ sent: '2027-04-09T23:00:00Z' });
    expect(await sendReminderNow(db as never, createFakeMailer(), 'r1', SIX_PM_CDT, APP, false)).toBeNull();
    const mailer = createFakeMailer();
    expect(await sendReminderNow(db as never, mailer, 'r1', SIX_PM_CDT, APP, true)).toBe(3);
  });
  it('a sent manual reminder stops the scheduled one', async () => {
    await sendReminderNow(db as never, createFakeMailer(), 'r1', new Date('2027-04-09T15:00:00Z'), APP, false);
    expect(await sendDueReminders(db as never, createFakeMailer(), SIX_PM_CDT, APP)).toEqual({ rounds: 0, emails: 0 });
  });
});

describe('match reminders (self-scheduled bracket matches)', () => {
  function seedMatch(over: { result?: string | null; forfeit?: boolean; mode?: string } = {}) {
    db = createFakeDb({
      events: [{ id: E, name: 'Hackers Match Play', status: 'in_progress', handicap_mode: 'net', reminder_mode: over.mode ?? 'auto', reminder_time: '18:00:00' }],
      rounds: [{ id: 'm1', event_id: E, round_number: 4, play_date: '2027-04-10', kind: 'match', tee_id: 't1', reminder_sent_at: null }],
      tees: [{ id: 't1', name: 'White', course_id: 'c1' }],
      courses: [{ id: 'c1', name: 'Cherokee Ridge' }],
      players: P.map((id, i) => ({ id, name: `Player ${i + 1}`, email: `p${i + 1}@example.test` })),
      registrations: P.map((id, i) => ({ id: `reg${i}`, event_id: E, player_id: id, status: 'registered' })),
      groups: [{ id: 'mg', round_id: 'm1', tee_time: null, start_hole: 1, code: 'MATCH2' }],
      group_players: [
        { id: 'a', group_id: 'mg', player_id: 'p1', withdrawn: false },
        { id: 'b', group_id: 'mg', player_id: 'p2', withdrawn: false },
      ],
      bracket_matches: [{ id: 'bm', bracket_id: 'br', match_key: 'R2M3', round: 2, group_id: 'mg', result: over.result ?? null, forfeit: over.forfeit ?? false }],
    });
  }

  it('emails both players the evening before, naming the opponent and the match', async () => {
    seedMatch();
    const mailer = createFakeMailer();
    expect(await sendDueReminders(db as never, mailer, SIX_PM_CDT, APP)).toEqual({ rounds: 1, emails: 2 });
    const p1 = mailer.sent.find((m) => m.to === 'p1@example.test')!;
    expect(p1.subject).toBe('Tomorrow: your match vs Player 2');
    expect(p1.html).toContain('Round 2, match 3');
    expect(p1.html).toContain('Player 2');
    expect(p1.html).toContain(`${APP}/c/MATCH2`);
    expect(p1.html).toContain('Cherokee Ridge');
    expect(p1.html).not.toContain('Round 4'); // the internal round number means nothing to players
    expect(mailer.sent.find((m) => m.to === 'p2@example.test')!.subject).toBe('Tomorrow: your match vs Player 1');
  });
  it('no reminder for a match already decided or forfeited, or on a manual event', async () => {
    for (const over of [{ result: '3&2' }, { forfeit: true }, { mode: 'manual' }]) {
      seedMatch(over);
      const mailer = createFakeMailer();
      expect(await sendDueReminders(db as never, mailer, SIX_PM_CDT, APP)).toEqual({ rounds: 0, emails: 0 });
    }
  });
  it('Send now works for a match too', async () => {
    seedMatch({ mode: 'manual' });
    const mailer = createFakeMailer();
    expect(await sendReminderNow(db as never, mailer, 'm1', new Date('2027-04-08T15:00:00Z'), APP, false)).toBe(2);
    expect(mailer.sent[0]!.subject).toBe('Coming up: your match vs Player 2');
  });
});
