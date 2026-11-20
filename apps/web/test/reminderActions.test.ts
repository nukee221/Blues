import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeDb';
import { createFakeMailer } from '@/lib/mailer';

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>, requireCommissioner: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireCommissioner: h.requireCommissioner }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.db }));

import { saveReminderSettings, sendRoundReminderNow } from '@/actions/reminders';

const EV = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const codeOf = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);

beforeEach(() => {
  process.env.APP_URL = 'https://tour.example.test';
  h.requireCommissioner.mockResolvedValue({ userId: 'u', player: { id: 'boss' } });
  h.db = createFakeDb({
    events: [{ id: EV, name: 'Masters 2027', status: 'published', reminder_mode: 'auto', reminder_time: '18:00:00' }],
    rounds: [{ id: R, event_id: EV, round_number: 1, play_date: '2099-04-10', kind: 'stroke', tee_id: 't', reminder_sent_at: null }],
    tees: [],
    courses: [],
    groups: [],
    group_players: [],
    registrations: [{ id: 'g', event_id: EV, player_id: 'p1', status: 'registered' }],
    players: [{ id: 'p1', name: 'Alex Turner', email: 'a@example.test' }],
    audit_log: [],
  });
});

describe('saveReminderSettings', () => {
  it('saves mode and time, and logs who changed it', async () => {
    expect(codeOf(await saveReminderSettings({ eventId: EV, mode: 'manual', time: '19:30' }))).toBe('ok');
    expect(h.db.tables.events![0]).toMatchObject({ reminder_mode: 'manual', reminder_time: '19:30:00' });
    expect(h.db.tables.audit_log).toEqual([expect.objectContaining({ actor_player_id: 'boss', entity: 'event', entity_id: EV })]);
  });
  it('quarter hours only', async () => {
    expect(codeOf(await saveReminderSettings({ eventId: EV, mode: 'auto', time: '18:10' }))).toBe('invalid');
  });
  it('commissioners only', async () => {
    h.requireCommissioner.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(saveReminderSettings({ eventId: EV, mode: 'auto', time: '18:00' })).rejects.toThrow(/forbidden/);
  });
});

describe('sendRoundReminderNow', () => {
  it('sends, logs, then asks before sending again', async () => {
    const mailer = createFakeMailer();
    expect(await sendRoundReminderNow(R, false, mailer)).toEqual({ ok: true, data: { sent: 1 } });
    expect(mailer.sent).toHaveLength(1);
    expect(codeOf(await sendRoundReminderNow(R, false, mailer))).toBe('already_sent');
    expect(await sendRoundReminderNow(R, true, mailer)).toEqual({ ok: true, data: { sent: 1 } });
    expect(mailer.sent).toHaveLength(2);
    expect(h.db.tables.audit_log!.filter((a) => a.entity === 'round')).toHaveLength(2);
  });
  it('refuses drafts and finished events', async () => {
    h.db.tables.events![0]!.status = 'final';
    expect(codeOf(await sendRoundReminderNow(R, false, createFakeMailer()))).toBe('wrong_status');
  });
  it('a failed send is reported and can be retried', async () => {
    const failing = { ...createFakeMailer(), sendBatch: async () => { throw new Error('down'); } };
    expect(codeOf(await sendRoundReminderNow(R, false, failing))).toBe('email_failed');
    expect(h.db.tables.rounds![0]!.reminder_sent_at).toBeNull();
  });
});

import { REMINDER_TIMES, timeLabel } from '@/components/ReminderAdmin';
describe('reminder time choices', () => {
  it('quarter hours from noon to 10 PM, labelled for people', () => {
    expect(REMINDER_TIMES[0]).toBe('12:00');
    expect(REMINDER_TIMES).toContain('18:00');
    expect(REMINDER_TIMES.at(-1)).toBe('22:00');
    expect([timeLabel('18:00'), timeLabel('12:15'), timeLabel('19:45')]).toEqual(['6:00 PM', '12:15 PM', '7:45 PM']);
  });
});
