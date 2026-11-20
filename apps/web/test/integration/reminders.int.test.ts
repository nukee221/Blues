import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';
import { createFakeMailer } from '@/lib/mailer';
import { sendRoundReminders } from '@/lib/reminders';

// The 6 PM reminder against real tables (service role), on a far-future date no other test uses.
const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const NOW = new Date('2096-06-01T23:05:00Z'); // 6:05 PM CDT, the evening before 2096-06-02
let eventId: string;
let roundId: string;
let playerIds: string[];

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id').limit(1).single();
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT reminder ${stamp}`, event_type: 'regular', status: 'published' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: r, error: rErr } = await admin
    .from('rounds')
    .insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, play_date: '2096-06-02', kind: 'stroke' })
    .select('id')
    .single();
  if (rErr) throw rErr;
  roundId = r!.id;
  const { data: ps } = await admin.from('players').select('id').order('email').limit(3);
  playerIds = ps!.map((p) => p.id);
  const { error: regErr } = await admin.from('registrations').insert(playerIds.map((player_id) => ({ event_id: eventId, player_id, status: 'registered' })));
  if (regErr) throw regErr;
});

afterAll(async () => {
  await admin.from('events').delete().eq('id', eventId);
});

describe('sendRoundReminders (real database)', () => {
  it('emails the registered players once and marks the round', async () => {
    const mailer = createFakeMailer();
    expect(await sendRoundReminders(admin, mailer, NOW, 'http://localhost:3000')).toEqual({ rounds: 1, emails: 3 });
    expect(mailer.sent.every((m) => m.subject === `Tomorrow: INT reminder ${stamp}, round 1`)).toBe(true);
    const { data: round } = await admin.from('rounds').select('reminder_sent_at').eq('id', roundId).single();
    expect(round!.reminder_sent_at).toBeTruthy();
    const again = createFakeMailer();
    expect(await sendRoundReminders(admin, again, NOW, 'http://localhost:3000')).toEqual({ rounds: 0, emails: 0 });
  });
});
