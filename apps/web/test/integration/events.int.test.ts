import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

const env = localSupabase();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.url, env.serviceKey, opts);

const stamp = Date.now();
const email = `events-int-${stamp}@example.test`;
const password = `pw-${stamp}-Aa1!`;
let userId: string;
let playerId: string;
let draftId: string;
let publishedId: string;
let user: SupabaseClient;

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: ev, error } = await admin
    .from('events')
    .insert([
      { season_id: season!.id, name: `INT draft ${stamp}`, event_type: 'regular', status: 'draft' },
      { season_id: season!.id, name: `INT published ${stamp}`, event_type: 'regular', status: 'published' },
    ])
    .select('id, status');
  if (error) throw error;
  draftId = ev!.find((e) => e.status === 'draft')!.id;
  publishedId = ev!.find((e) => e.status === 'published')!.id;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  // A seeded non-commissioner player.
  const { data: player } = await admin
    .from('players')
    .select('id')
    .eq('email', 'player04@example.test')
    .eq('is_commissioner', false)
    .single();
  playerId = player!.id;
  const link = await admin.from('players').update({ user_id: userId }).eq('id', playerId);
  if (link.error) throw link.error;
  await admin.from('registrations').insert({ event_id: publishedId, player_id: playerId });

  user = createClient(env.url, env.anonKey, opts);
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
});

afterAll(async () => {
  await admin.from('events').delete().in('id', [draftId, publishedId].filter(Boolean)); // cascades registrations
  if (playerId) await admin.from('players').update({ user_id: null }).eq('id', playerId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe('events RLS for a non-commissioner player', () => {
  it('events list excludes drafts but includes published', async () => {
    const { data, error } = await user.from('events').select('id, status');
    expect(error).toBeNull();
    const ids = (data ?? []).map((e) => e.id);
    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(draftId);
    expect((data ?? []).every((e) => e.status !== 'draft')).toBe(true);
  });
  it('a draft is not readable by id', async () => {
    const { data } = await user.from('events').select('id').eq('id', draftId).maybeSingle();
    expect(data).toBeNull();
  });
  it('registered list of a published event is readable with names via public_players', async () => {
    const { data: regs } = await user.from('registrations').select('player_id').eq('event_id', publishedId);
    expect(regs?.map((r) => r.player_id)).toContain(playerId);
    const { data: names } = await user.from('public_players').select('id, name').in('id', [playerId]);
    expect(names?.[0]?.name).toBeTruthy();
  });
});
