import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';
import { createFakeMailer } from '@/lib/mailer';
import { sendDueReminders } from '@/lib/reminders';

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

describe('sendDueReminders (real database)', () => {
  it('emails the registered players once and marks the round', async () => {
    const mailer = createFakeMailer();
    expect(await sendDueReminders(admin, mailer, NOW, 'http://localhost:3000')).toEqual({ rounds: 1, emails: 3 });
    expect(mailer.sent.every((m) => m.subject === `Tomorrow: INT reminder ${stamp}, round 1`)).toBe(true);
    const { data: round } = await admin.from('rounds').select('reminder_sent_at').eq('id', roundId).single();
    expect(round!.reminder_sent_at).toBeTruthy();
    const again = createFakeMailer();
    expect(await sendDueReminders(admin, again, NOW, 'http://localhost:3000')).toEqual({ rounds: 0, emails: 0 });
  });
  it('a self-scheduled bracket match reminds its two players', async () => {
    const { data: season } = await admin.from('seasons').select('id').limit(1).single();
    const { data: tee } = await admin.from('tees').select('id').limit(1).single();
    const { data: ev, error } = await admin
      .from('events')
      .insert({ season_id: season!.id, name: `INT match reminder ${stamp}`, event_type: 'match_play', format: 'match_play', status: 'in_progress' })
      .select('id')
      .single();
    if (error) throw error;
    try {
      const { data: r } = await admin.from('rounds').insert({ event_id: ev!.id, round_number: 2, tee_id: tee!.id, play_date: '2096-06-02', kind: 'match' }).select('id').single();
      const { data: g, error: gErr } = await admin.from('groups').insert({ round_id: r!.id, start_hole: 1 }).select('id').single();
      if (gErr) throw gErr;
      await admin.from('group_players').insert(playerIds.slice(0, 2).map((player_id) => ({ group_id: g!.id, player_id })));
      const { data: br, error: bErr } = await admin.from('brackets').insert({ event_id: ev!.id, size: 8, rounds: 3 }).select('id').single();
      if (bErr) throw bErr;
      const { error: mErr } = await admin.from('bracket_matches').insert({ bracket_id: br!.id, match_key: 'R1M2', round: 1, group_id: g!.id });
      if (mErr) throw mErr;
      const mailer = createFakeMailer();
      const res = await sendDueReminders(admin, mailer, NOW, 'http://localhost:3000');
      expect(res).toEqual({ rounds: 1, emails: 2 }); // the stroke round above was already sent
      const mine = mailer.sent.filter((m) => m.subject.startsWith('Tomorrow: your match vs'));
      expect(mine).toHaveLength(2);
      expect(mine[0]!.html).toContain('Round 1, match 2');
    } finally {
      await admin.from('events').delete().eq('id', ev!.id);
    }
  });

});
