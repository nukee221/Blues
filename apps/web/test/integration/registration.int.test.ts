import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

const env = localSupabase();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.url, env.serviceKey, opts);

const stamp = Date.now();
const email = `reg-int-${stamp}@example.test`;
const password = `pw-${stamp}-Aa1!`;
let userId: string;
let playerId: string;
let openId: string;
let closedId: string;
let user: SupabaseClient;

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const day = 86_400_000;
  const { data: ev, error } = await admin
    .from('events')
    .insert([
      { season_id: season!.id, name: `INT reg open ${stamp}`, event_type: 'regular', status: 'published', registration_deadline: new Date(Date.now() + day).toISOString() },
      { season_id: season!.id, name: `INT reg closed ${stamp}`, event_type: 'regular', status: 'published', registration_deadline: new Date(Date.now() - day).toISOString() },
    ])
    .select('id, name');
  if (error) throw error;
  openId = ev!.find((e) => e.name.includes('open'))!.id;
  closedId = ev!.find((e) => e.name.includes('closed'))!.id;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const { data: player } = await admin
    .from('players')
    .select('id')
    .eq('email', 'player05@example.test')
    .eq('is_commissioner', false)
    .single();
  playerId = player!.id;
  const link = await admin.from('players').update({ user_id: userId }).eq('id', playerId);
  if (link.error) throw link.error;

  user = createClient(env.url, env.anonKey, opts);
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
});

afterAll(async () => {
  await admin.from('events').delete().in('id', [openId, closedId].filter(Boolean)); // cascades registrations
  if (playerId) await admin.from('players').update({ user_id: null }).eq('id', playerId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe('registration RLS for a player session', () => {
  it('can register on a published event before the deadline, then withdraw via status update', async () => {
    const ins = await user.from('registrations').insert({ event_id: openId, player_id: playerId, status: 'registered' });
    expect(ins.error).toBeNull();
    const upd = await user.from('registrations').update({ status: 'withdrawn' }).eq('event_id', openId).eq('player_id', playerId).select('status');
    expect(upd.error).toBeNull();
    expect(upd.data?.[0]?.status).toBe('withdrawn');
  });
  it('is rejected after the deadline (insert denied)', async () => {
    const ins = await user.from('registrations').insert({ event_id: closedId, player_id: playerId, status: 'registered' });
    expect(ins.error).not.toBeNull();
    const { data } = await admin.from('registrations').select('id').eq('event_id', closedId);
    expect(data).toEqual([]);
  });
  it('cannot change a registration after the deadline (update affects no rows)', async () => {
    await admin.from('registrations').insert({ event_id: closedId, player_id: playerId });
    const upd = await user.from('registrations').update({ status: 'withdrawn' }).eq('event_id', closedId).eq('player_id', playerId).select('status');
    expect(upd.data ?? []).toEqual([]);
    const { data } = await admin.from('registrations').select('status').eq('event_id', closedId).single();
    expect(data?.status).toBe('registered');
  });
});
