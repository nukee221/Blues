import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// Real tables, triggers and RPCs via the service role; only the signed-in user and the mailer are stubbed.
const h = vi.hoisted(() => ({ admin: null as unknown, server: null as unknown, me: { id: '', is_commissioner: false }, commish: '' as string, sent: [] as { to: string }[] }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ userId: 'u', player: h.me }),
  requireCommissioner: async () => ({ userId: 'c', player: { id: h.commish, is_commissioner: true } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.server ?? h.admin }));
vi.mock('@/lib/mailer', () => ({
  getMailer: () => ({ send: async () => {}, sendBatch: async (m: { to: string }[]) => void h.sent.push(...m) }),
}));

import { closePlayIn, createMatchCard, drawEventBracket, getBracketView } from '@/actions/bracket';
import { adminSignCard } from '@/actions/signing';
import type { ActionResult } from '@/lib/actionResult';
import type { Bracket } from '@hgt/scoring';

function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r.data;
}

const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
h.admin = admin;

const stamp = Date.now();
const email = `bracket-int-${stamp}@example.test`;
const password = `pw-${stamp}-Aa1!`;
let userId: string | undefined;
let eventId: string;
let teeId: string;
let players: string[] = [];
const auditIds: string[] = [];

beforeAll(async () => {
  process.env.APP_URL = 'https://tour.example.test';
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id, holes(number, par)').limit(1).single();
  teeId = tee!.id;
  const par = new Map((tee!.holes as { number: number; par: number }[]).map((x) => [x.number, x.par]));
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT bracket ${stamp}`, event_type: 'match_play', format: 'match_play', status: 'in_progress', handicap_mode: 'gross' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: ps } = await admin.from('players').select('id, email, is_commissioner').like('email', 'player%@example.test').order('email');
  players = ps!.slice(0, 12).map((p) => p.id);
  h.commish = ps!.find((p) => p.is_commissioner)!.id;
  await admin.from('registrations').insert(players.map((player_id) => ({ event_id: eventId, player_id })));
  const { data: round, error: rErr } = await admin.from('rounds').insert({ event_id: eventId, round_number: 1, tee_id: teeId, kind: 'stroke' }).select('id').single();
  if (rErr) throw rErr;
  for (let g = 0; g < 3; g++) {
    const { data: group, error: gErr } = await admin.from('groups').insert({ round_id: round!.id }).select('id').single();
    if (gErr) throw gErr;
    const ids = players.slice(g * 4, g * 4 + 4);
    await admin.from('group_players').insert(ids.map((player_id) => ({ group_id: group!.id, player_id, playing_handicap: 0 })));
    // Player i (0..11) is par + 1 on the first i holes: distinct totals, player 0 best.
    const rows = ids.flatMap((player_id, k) =>
      Array.from({ length: 18 }, (_, hole) => ({ group_id: group!.id, player_id, hole: hole + 1, gross: par.get(hole + 1)! + (hole < g * 4 + k ? 1 : 0) })),
    );
    const { error: sErr } = await admin.from('scores').insert(rows);
    if (sErr) throw sErr;
    await admin.from('groups').update({ locked: true, signed_at: new Date().toISOString() }).eq('id', group!.id);
    auditIds.push(group!.id);
  }
});

afterAll(async () => {
  h.server = null;
  if (players[10]) await admin.from('players').update({ user_id: null }).eq('id', players[10]);
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (!eventId) return;
  const { data: b } = await admin.from('brackets').select('id').eq('event_id', eventId).maybeSingle();
  if (b) {
    auditIds.push(b.id);
    const { data: bms } = await admin.from('bracket_matches').select('id, group_id').eq('bracket_id', b.id);
    for (const m of bms ?? []) auditIds.push(m.id, ...(m.group_id ? [m.group_id] : []));
  }
  auditIds.push(eventId);
  await admin.from('audit_log').delete().in('entity_id', auditIds);
  await admin.from('events').delete().eq('id', eventId);
});

describe('match-play bracket against local Supabase', () => {
  it('12 registered -> play-in signed -> close -> draw -> match card -> scores -> both sign -> winner advanced', async () => {
    expect(data(await closePlayIn(eventId))).toEqual({ advanced: players.slice(0, 6) });

    const bracket = data(await drawEventBracket(eventId));
    expect(bracket).toMatchObject({ size: 8, rounds: 3 });
    expect(bracket.matches.filter((m) => m.isBye)).toHaveLength(2);
    const { data: row } = await admin.from('brackets').select('id, version, state').eq('event_id', eventId).single();
    expect(row!.version).toBe(1);
    expect((row!.state as { bracket: Bracket }).bracket).toEqual(bracket);
    const { data: bms } = await admin.from('bracket_matches').select('match_key, round').eq('bracket_id', row!.id).order('match_key');
    expect(bms!.map((m) => m.match_key)).toEqual(['R1M1', 'R1M2', 'R1M3', 'R1M4', 'R2M1', 'R2M2', 'R3M1']);

    const m = bracket.matches.find((x) => x.round === 1 && !x.isBye)!;
    h.me = { id: m.a!, is_commissioner: false };
    const card = data(await createMatchCard(eventId, m.id, null, '2027-03-02'));
    expect(card).toMatchObject({ created: true, emailed: true });
    expect(h.sent).toHaveLength(2);
    const { data: bm } = await admin.from('bracket_matches').select('id, group_id').eq('bracket_id', row!.id).eq('match_key', m.id).single();
    const gid = bm!.group_id as string;
    const { data: group } = await admin.from('groups').select('code, round_id').eq('id', gid).single();
    expect(group!.code).toBe(card.code);
    const { data: matchRound } = await admin.from('rounds').select('round_number, kind, tee_id, play_date').eq('id', group!.round_id).single();
    expect(matchRound).toEqual({ round_number: 2, kind: 'match', tee_id: teeId, play_date: '2027-03-02' });
    const { data: gps } = await admin.from('group_players').select('player_id, index_snapshot').eq('group_id', gid);
    expect(gps!.map((g) => g.player_id).sort()).toEqual([m.a, m.b].sort());
    expect(gps!.every((g) => g.index_snapshot !== null)).toBe(true);

    // Scratch match so the result follows gross: a wins the first 3 holes, then all halved -> 3&2.
    await admin.from('group_players').update({ playing_handicap: 0 }).eq('group_id', gid);
    const { data: holes } = await admin.from('holes').select('number, par').eq('tee_id', teeId);
    const rows = (holes ?? []).flatMap((x) => [
      { group_id: gid, player_id: m.a, hole: x.number, gross: x.par - (x.number <= 3 ? 1 : 0) },
      { group_id: gid, player_id: m.b, hole: x.number, gross: x.par },
    ]);
    const { error: sErr } = await admin.from('scores').insert(rows);
    expect(sErr).toBeNull();
    await admin.from('groups').update({ scorer_player_id: m.a }).eq('id', gid);
    expect(data(await adminSignCard(gid, m.a!, 'scorer'))).toEqual({ locked: false });
    expect(data(await adminSignCard(gid, m.b!, 'attest'))).toEqual({ locked: true });

    const { data: after } = await admin.from('brackets').select('state').eq('id', row!.id).single();
    const b2 = (after!.state as { bracket: Bracket }).bracket;
    expect(b2.matches.find((x) => x.id === m.id)!.winner).toBe(m.a);
    const next = b2.matches.find((x) => x.round === 2 && x.slot === Math.ceil(m.slot / 2))!;
    expect(m.slot % 2 === 1 ? next.a : next.b).toBe(m.a);
    const { data: result } = await admin.from('bracket_matches').select('result, forfeit').eq('id', bm!.id).single();
    expect(result).toEqual({ result: '3&2', forfeit: false });

    // The player view shows the result and the participant's code.
    const view = data(await getBracketView(eventId));
    expect(view.matches.find((x) => x.key === m.id)).toMatchObject({ kind: 'final', status: '3&2', mine: true, code: card.code });
  });

  it('a real player session (RLS) reads the bracket; codes stay hidden from a non-participant', async () => {
    const viewer = players[10]!; // did not advance
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const link = await admin.from('players').update({ user_id: userId }).eq('id', viewer);
    if (link.error) throw link.error;
    const user = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    h.server = user;
    h.me = { id: viewer, is_commissioner: false };
    const view = data(await getBracketView(eventId));
    expect(view.drawn).toBe(true);
    expect(view.matches).toHaveLength(7);
    expect(view.matches.some((x) => x.kind === 'final' && x.status === '3&2')).toBe(true);
    expect(view.matches.every((x) => x.code === null && !x.mine)).toBe(true);
    expect(Object.keys(view.names).length).toBeGreaterThanOrEqual(12);
  });
});
