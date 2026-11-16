import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// A real signed-in player session (RLS applies) reads the leaderboard.
const h = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.user }));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ userId: 'u', player: { id: 'p' } }) }));

import { getRoundLeaderboard } from '@/actions/leaderboard';

const env = localSupabase();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.url, env.serviceKey, opts);

const stamp = Date.now();
const email = `lb-int-${stamp}@example.test`;
const password = `pw-${stamp}-Aa1!`;
let userId: string;
let viewerId: string;
let pubEvent: string;
let draftEvent: string;
let pubRound: string;
let draftRound: string;
let a: string;
let b: string;
let user: SupabaseClient;

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id, holes(number, par)').limit(1).single();
  const par = new Map((tee!.holes as { number: number; par: number }[]).map((x) => [x.number, x.par]));
  const { data: evs, error } = await admin
    .from('events')
    .insert([
      { season_id: season!.id, name: `INT lb pub ${stamp}`, event_type: 'match_play', format: 'match_play', status: 'in_progress', handicap_mode: 'gross' },
      { season_id: season!.id, name: `INT lb draft ${stamp}`, event_type: 'regular', status: 'draft', handicap_mode: 'gross' },
    ])
    .select('id, name');
  if (error) throw error;
  pubEvent = evs!.find((e) => e.name.includes('pub'))!.id;
  draftEvent = evs!.find((e) => e.name.includes('draft'))!.id;
  const { data: rounds, error: rErr } = await admin
    .from('rounds')
    .insert([pubEvent, draftEvent].map((event_id) => ({ event_id, round_number: 1, tee_id: tee!.id, kind: 'stroke' })))
    .select('id, event_id');
  if (rErr) throw rErr;
  pubRound = rounds!.find((r) => r.event_id === pubEvent)!.id;
  draftRound = rounds!.find((r) => r.event_id === draftEvent)!.id;

  const { data: ps } = await admin.from('players').select('id').in('email', ['player02@example.test', 'player03@example.test', 'player05@example.test']).order('email');
  [a, b, viewerId] = ps!.map((p) => p.id);
  const mk = async (round: string, locked: boolean) => {
    const { data: g, error: gErr } = await admin.from('groups').insert({ round_id: round, locked }).select('id').single();
    if (gErr) throw gErr;
    await admin.from('group_players').insert([a, b].map((player_id) => ({ group_id: g!.id, player_id, playing_handicap: 0 })));
    // a: par on 1-9 (thru 9); b: par+1 on 1-3 (thru 3)
    const scores = [
      ...Array.from({ length: 9 }, (_, i) => ({ group_id: g!.id, player_id: a, hole: i + 1, gross: par.get(i + 1)! })),
      ...Array.from({ length: 3 }, (_, i) => ({ group_id: g!.id, player_id: b, hole: i + 1, gross: par.get(i + 1)! + 1 })),
    ];
    const s = await admin.from('scores').insert(scores);
    if (s.error) throw s.error;
  };
  await mk(pubRound, false);
  await mk(draftRound, false);
  for (let i = 0; i < 12; i++) {
    const { data: p } = await admin.from('players').select('id').order('email').range(i, i).single();
    await admin.from('registrations').insert({ event_id: pubEvent, player_id: p!.id });
  }

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const link = await admin.from('players').update({ user_id: userId }).eq('id', viewerId);
  if (link.error) throw link.error;
  user = createClient(env.url, env.anonKey, opts);
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  h.user = user;
});

afterAll(async () => {
  await admin.from('events').delete().in('id', [pubEvent, draftEvent].filter(Boolean));
  if (viewerId) await admin.from('players').update({ user_id: null }).eq('id', viewerId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe('getRoundLeaderboard with a real player session', () => {
  it('reads a published event leaderboard with names, thru and the cut line', async () => {
    const r = await getRoundLeaderboard(pubRound);
    if (!r.ok) throw new Error(`${r.code}: ${r.error}`);
    expect(r.data.rows.map((x) => x.playerId)).toEqual([a, b]);
    expect(r.data.rows.map((x) => x.thru)).toEqual([9, 3]);
    expect(r.data.rows[0]).toMatchObject({ toPar: 0, position: 1, tied: false, signed: false, advancing: false });
    expect(r.data.rows[1]!.toPar).toBe(3);
    expect(r.data.rows[0]!.name).toBeTruthy();
    expect(r.data.cutLine).toBe(6);
    expect(r.data.mode).toBe('gross');
  });
  it('a draft event round is not_found for a player', async () => {
    expect(await getRoundLeaderboard(draftRound)).toMatchObject({ ok: false, code: 'not_found' });
  });
});
