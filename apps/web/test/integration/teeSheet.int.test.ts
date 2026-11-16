import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// Real tables via the service role; only auth (no cookie session in tests) is stubbed.
const h = vi.hoisted(() => ({ admin: null as unknown, commissionerId: '' }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/auth', () => ({ requireCommissioner: async () => ({ userId: 'u', player: { id: h.commissionerId } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.admin }));

import { saveGroups, sendTeeSheet } from '@/actions/teeSheet';
import { createFakeMailer } from '@/lib/mailer';

const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
h.admin = admin;

const stamp = Date.now();
let eventId: string;
let roundId: string;
let round2Id: string;
let players: { id: string; handicap_index: number }[] = [];

beforeAll(async () => {
  process.env.APP_URL = 'http://localhost:3000';
  const { data: commish } = await admin.from('players').select('id').eq('email', 'player01@example.test').single();
  h.commissionerId = commish!.id;
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id').limit(1).single();
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT tee sheet ${stamp}`, event_type: 'regular', status: 'registration_closed', handicap_mode: 'net', allowance_pct: 90, handicap_basis: 'course' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: round, error: rErr } = await admin
    .from('rounds')
    .insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, play_date: '2027-04-10', kind: 'stroke' })
    .select('id')
    .single();
  if (rErr) throw rErr;
  roundId = round!.id;
  const { data: round2, error: r2Err } = await admin
    .from('rounds')
    .insert({ event_id: eventId, round_number: 2, tee_id: tee!.id, play_date: '2027-04-11', kind: 'stroke' })
    .select('id')
    .single();
  if (r2Err) throw r2Err;
  round2Id = round2!.id;
  const { data: ps } = await admin
    .from('players')
    .select('id, handicap_index')
    .in('email', ['player06@example.test', 'player07@example.test', 'player08@example.test', 'player09@example.test'])
    .order('email');
  players = (ps ?? []).map((p) => ({ id: p.id, handicap_index: Number(p.handicap_index) }));
  const reg = await admin.from('registrations').insert(players.map((p) => ({ event_id: eventId, player_id: p.id })));
  if (reg.error) throw reg.error;
});

afterAll(async () => {
  for (const p of players) await admin.from('players').update({ handicap_index: p.handicap_index }).eq('id', p.id);
  if (eventId) {
    await admin.from('audit_log').delete().in('entity_id', [eventId, roundId, round2Id].filter(Boolean));
    await admin.from('events').delete().eq('id', eventId); // cascades rounds, groups, group_players
  }
});

async function snapshot(rid = roundId) {
  const { data: groups } = await admin.from('groups').select('id, code').eq('round_id', rid).order('id');
  const { data: gps } = await admin
    .from('group_players')
    .select('player_id, index_snapshot, playing_handicap')
    .in('group_id', (groups ?? []).map((g) => g.id))
    .order('player_id');
  return { groups: groups ?? [], gps: gps ?? [] };
}

describe('tee sheet against local Supabase', () => {
  it('index change after send does not change snapshot; resend keeps codes', async () => {
    await saveGroups(roundId, [
      { teeTime: '08:10', startHole: 1, playerIds: [players[0]!.id, players[1]!.id], scorerPlayerId: players[0]!.id },
      { teeTime: '08:20', startHole: 10, playerIds: [players[2]!.id, players[3]!.id], scorerPlayerId: null },
    ]);
    const mailer = createFakeMailer();
    await expect(sendTeeSheet(roundId, mailer)).resolves.toEqual({ sent: 4 });

    const first = await snapshot();
    expect(first.groups).toHaveLength(2);
    expect(first.groups.every((g) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(g.code!))).toBe(true);
    expect(first.gps).toHaveLength(4);
    expect(first.gps.every((r) => r.index_snapshot != null && r.playing_handicap != null)).toBe(true);
    // player06 index 10.0 on Blue (71.8/140/72), course basis at 90%: (10*140/113 - 0.2) * 0.9 = 10.97 -> 11
    expect(first.gps.find((r) => r.player_id === players[0]!.id)).toMatchObject({ index_snapshot: 10, playing_handicap: 11 });
    const { data: ev } = await admin.from('events').select('status').eq('id', eventId).single();
    expect(ev!.status).toBe('in_progress');

    for (const p of players) await admin.from('players').update({ handicap_index: 30.0 }).eq('id', p.id);
    const reloaded = await snapshot();
    expect(reloaded.gps).toEqual(first.gps);

    const again = createFakeMailer();
    await expect(sendTeeSheet(roundId, again)).resolves.toEqual({ sent: 4 });
    const afterResend = await snapshot();
    expect(afterResend).toEqual(first);
    for (const g of first.groups) expect(again.sent.filter((m) => m.html.includes(`/c/${g.code}`))).toHaveLength(2);
  });

  it('moving players keeps every snapshot for the round (no re-snapshot from the current index)', async () => {
    for (const p of players) await admin.from('players').update({ handicap_index: p.handicap_index }).eq('id', p.id);
    const [a, b, c, d] = players.map((p) => p.id) as [string, string, string, string];
    await saveGroups(round2Id, [
      { teeTime: '09:00', startHole: 1, playerIds: [a, b], scorerPlayerId: null },
      { teeTime: '09:10', startHole: 1, playerIds: [c, d], scorerPlayerId: null },
    ]);
    await sendTeeSheet(round2Id, createFakeMailer());
    const first = await snapshot(round2Id);

    for (const p of players) await admin.from('players').update({ handicap_index: 30.0 }).eq('id', p.id);
    await saveGroups(round2Id, [
      { teeTime: '09:00', startHole: 1, playerIds: [a, b, c], scorerPlayerId: null },
      { teeTime: '09:10', startHole: 1, playerIds: [d], scorerPlayerId: null },
    ]);
    await sendTeeSheet(round2Id, createFakeMailer());
    const after = await snapshot(round2Id);
    expect(after.gps).toEqual(first.gps);
    expect(after.gps.every((r) => Number(r.index_snapshot) !== 30)).toBe(true);
  });

  it('refuses to move a player out of a group with scores; the scorecard survives', async () => {
    const [a, b, c, d] = players.map((p) => p.id) as [string, string, string, string];
    const { groups } = await snapshot(round2Id);
    const { data: gps } = await admin.from('group_players').select('group_id').eq('player_id', d).in('group_id', groups.map((g) => g.id)).single();
    const scored = gps!.group_id;
    const ins = await admin.from('scores').insert({ group_id: scored, player_id: d, hole: 1, gross: 5 });
    expect(ins.error).toBeNull();

    await expect(
      saveGroups(round2Id, [
        { teeTime: '09:00', startHole: 1, playerIds: [a, b], scorerPlayerId: null },
        { teeTime: '09:10', startHole: 1, playerIds: [c, d], scorerPlayerId: null },
      ]),
    ).rejects.toThrow(/Scores have been entered/);
    const { data: scores } = await admin.from('scores').select('id').eq('group_id', scored);
    expect(scores).toHaveLength(1);
    expect((await snapshot(round2Id)).groups).toEqual(groups);
  });

  it('refuses to send when a grouped player has withdrawn', async () => {
    const d = players[3]!.id;
    await admin.from('registrations').update({ status: 'withdrawn' }).eq('event_id', eventId).eq('player_id', d);
    const mailer = createFakeMailer();
    await expect(sendTeeSheet(round2Id, mailer)).rejects.toThrow('1 grouped player(s) are no longer registered; re-save groups');
    expect(mailer.sent).toEqual([]);
    await admin.from('registrations').update({ status: 'registered' }).eq('event_id', eventId).eq('player_id', d);
  });
});
