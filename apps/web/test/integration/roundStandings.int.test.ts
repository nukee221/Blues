import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';
import { standingsBefore } from '@/lib/roundStandings';

// "By standings" for round 2, against real tables (service role).
const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
let eventId: string;
let players: string[];

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id, holes(number, par)').limit(1).single();
  const pars = (tee!.holes as { number: number; par: number }[]).sort((a, b) => a.number - b.number).map((h) => h.par);
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT standings ${stamp}`, event_type: 'regular', status: 'in_progress', handicap_mode: 'gross' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: r1 } = await admin
    .from('rounds')
    .insert([1, 2].map((n) => ({ event_id: eventId, round_number: n, tee_id: tee!.id, play_date: `2097-06-1${n}`, kind: 'stroke' })))
    .select('id, round_number');
  const round1 = r1!.find((r) => r.round_number === 1)!.id;
  const { data: ps } = await admin.from('players').select('id').order('email').limit(4);
  players = ps!.map((p) => p.id);
  // two groups of two; strokes over par on hole 1: 2, 0 | 2, 5. Group A signed 2:10 PM CDT; group B never signed, tee time 8:20 AM CDT.
  const over = [2, 0, 2, 5];
  for (const [gi, signed] of [[0, '2097-06-11T19:10:00Z'], [1, null]] as const) {
    const { data: g, error: gErr } = await admin.from('groups').insert({ round_id: round1, code: `S${stamp % 100000}${gi}`, tee_time: gi ? '08:20' : '08:10' }).select('id').single();
    if (gErr) throw gErr;
    const pair = players.slice(gi * 2, gi * 2 + 2);
    await admin.from('group_players').insert(pair.map((player_id) => ({ group_id: g!.id, player_id, playing_handicap: 0 })));
    const rows = pair.flatMap((player_id, k) => pars.map((par, h) => ({ group_id: g!.id, player_id, hole: h + 1, gross: par + (h === 0 ? over[gi * 2 + k]! : 0) })));
    const { error: sErr } = await admin.from('scores').insert(rows);
    if (sErr) throw sErr;
    if (signed) await admin.from('groups').update({ signed_at: signed }).eq('id', g!.id);
  }
});

afterAll(async () => {
  await admin.from('events').delete().eq('id', eventId);
});

describe('standingsBefore', () => {
  it('totals round 1 and dates each finish: signed time, else the Central tee time', async () => {
    const s = await standingsBefore(admin, eventId, 2, 'gross');
    const row = (i: number) => {
      const e = s.get(players[i]!)!;
      return [e.toPar, e.finishedAt ? new Date(e.finishedAt).toISOString() : null];
    };
    expect(row(0)).toEqual([2, '2097-06-11T19:10:00.000Z']);
    expect(row(1)).toEqual([0, '2097-06-11T19:10:00.000Z']);
    expect(row(2)).toEqual([2, '2097-06-11T13:20:00.000Z']); // 8:20 AM CDT
    expect(row(3)).toEqual([5, '2097-06-11T13:20:00.000Z']);
  });
  it('round 1 has no standings', async () => {
    expect((await standingsBefore(admin, eventId, 1, 'gross')).size).toBe(0);
  });
});
