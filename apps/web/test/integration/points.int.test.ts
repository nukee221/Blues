import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// Real tables and policies; only the signed-in user (auth helpers) is stubbed. Standings are
// read through a real player session (anon key + password sign-in), so RLS applies.
const h = vi.hoisted(() => ({ server: null as unknown, admin: null as unknown, me: { id: '', is_commissioner: false }, commish: '' }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ userId: 'u', player: h.me }),
  requireCommissioner: async () => ({ userId: 'c', player: { id: h.commish, is_commissioner: true } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.server ?? h.admin }));
vi.mock('@/lib/mailer', () => ({ getMailer: () => ({ send: async () => {}, sendBatch: async () => {} }) }));

import { closePlayIn, drawEventBracket, awardForfeit } from '@/actions/bracket';
import { finalizeEvent, getStandings, overridePoints } from '@/actions/points';
import { setEventStatus } from '@/actions/events';
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
const email = `points-int-${stamp}@example.test`;
const password = `pw-${stamp}-Aa1!`;
let userId: string | undefined;
let viewer: string;
let seasonId: string;
let eventId: string;
let draftId: string;
let players: string[] = [];

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').eq('year', 2027).single();
  seasonId = season!.id;
  const { data: tee } = await admin.from('tees').select('id, holes(number, par)').limit(1).single();
  const par = new Map((tee!.holes as { number: number; par: number }[]).map((x) => [x.number, x.par]));
  const { data: evs, error } = await admin
    .from('events')
    .insert([
      { season_id: seasonId, name: `INT points ${stamp}`, event_type: 'match_play', format: 'match_play', status: 'in_progress', handicap_mode: 'gross' },
      { season_id: seasonId, name: `INT points draft ${stamp}`, event_type: 'regular', format: 'stroke', status: 'draft', handicap_mode: 'gross' },
    ])
    .select('id, status');
  if (error) throw error;
  eventId = evs!.find((e) => e.status === 'in_progress')!.id;
  draftId = evs!.find((e) => e.status === 'draft')!.id;

  const { data: ps } = await admin.from('players').select('id, email, is_commissioner').like('email', 'player%@example.test').order('email');
  players = ps!.slice(0, 12).map((p) => p.id);
  h.commish = ps!.find((p) => p.is_commissioner)!.id;
  viewer = ps!.find((p) => p.email === 'player07@example.test')!.id;
  await admin.from('registrations').insert(players.map((player_id) => ({ event_id: eventId, player_id })));
  const { data: round, error: rErr } = await admin.from('rounds').insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, kind: 'stroke', play_date: '2027-03-01' }).select('id').single();
  if (rErr) throw rErr;
  for (let g = 0; g < 3; g++) {
    const { data: group, error: gErr } = await admin.from('groups').insert({ round_id: round!.id }).select('id').single();
    if (gErr) throw gErr;
    const ids = players.slice(g * 4, g * 4 + 4);
    await admin.from('group_players').insert(ids.map((player_id) => ({ group_id: group!.id, player_id, playing_handicap: 0 })));
    // Player i is par + 1 on the first i holes: distinct totals, player 0 best.
    const rows = ids.flatMap((player_id, k) =>
      Array.from({ length: 18 }, (_, hole) => ({ group_id: group!.id, player_id, hole: hole + 1, gross: par.get(hole + 1)! + (hole < g * 4 + k ? 1 : 0) })),
    );
    const { error: sErr } = await admin.from('scores').insert(rows);
    if (sErr) throw sErr;
    await admin.from('groups').update({ locked: true, signed_at: new Date().toISOString() }).eq('id', group!.id);
  }
  // An award on a draft event: RLS must hide it from players.
  await admin.from('points_awards').insert({ event_id: draftId, player_id: viewer, points: 999, override: true });
});

afterAll(async () => {
  h.server = null;
  if (viewer) await admin.from('players').update({ user_id: null }).eq('id', viewer);
  if (userId) await admin.auth.admin.deleteUser(userId);
  const ids: string[] = [];
  for (const id of [eventId, draftId]) if (id) ids.push(id);
  if (eventId) {
    const { data: b } = await admin.from('brackets').select('id').eq('event_id', eventId).maybeSingle();
    if (b) {
      ids.push(b.id);
      const { data: bms } = await admin.from('bracket_matches').select('id').eq('bracket_id', b.id);
      ids.push(...(bms ?? []).map((m) => m.id));
    }
    const { data: groups } = await admin.from('groups').select('id, rounds!inner(event_id)').eq('rounds.event_id', eventId);
    ids.push(...(groups ?? []).map((g) => g.id));
  }
  await admin.from('audit_log').delete().in('entity_id', ids);
  // Signed play-in cards: the service role is not blocked by the delete guard (0005).
  await admin.from('events').delete().in('id', [eventId, draftId].filter(Boolean));
});

describe('points against local Supabase', () => {
  it('play-in -> draw -> forfeits -> finalize: 6-advancer awards; non-advancers none; final + audited; override survives reopen', async () => {
    // Before the bracket is decided the event cannot be finalized.
    expect(await finalizeEvent(eventId)).toMatchObject({ ok: false, code: 'bracket_incomplete' });

    const { advanced } = data(await closePlayIn(eventId)) as { advanced: string[] };
    expect(advanced).toEqual(players.slice(0, 6));
    let bracket = data(await drawEventBracket(eventId));
    for (let round = 1; round <= bracket.rounds; round++) {
      for (const m of bracket.matches.filter((x) => x.round === round && !x.isBye)) {
        data(await awardForfeit(eventId, m.id, m.a!));
      }
      const { data: row } = await admin.from('brackets').select('state').eq('event_id', eventId).single();
      bracket = (row!.state as { bracket: Bracket }).bracket;
    }
    const final = bracket.matches.find((m) => m.round === bracket.rounds)!;
    const champion = final.winner!;
    const runnerUp = final.a === champion ? final.b! : final.a!;

    const out = data(await finalizeEvent(eventId));
    expect(out.awards).toHaveLength(6);
    const { data: rows } = await admin.from('points_awards').select('player_id, points, override').eq('event_id', eventId);
    const pts = new Map((rows ?? []).map((r) => [r.player_id as string, Number(r.points)]));
    expect(pts.get(champion)).toBe(500);
    expect(pts.get(runnerUp)).toBe(300);
    expect([...pts.values()].sort((a, b) => b - a)).toEqual([500, 300, 162.5, 162.5, 105, 105]);
    for (const p of players.slice(6)) expect(pts.has(p)).toBe(false);
    const { data: ev } = await admin.from('events').select('status').eq('id', eventId).single();
    expect(ev!.status).toBe('final');
    const { data: logs } = await admin.from('audit_log').select('entity, before, after').eq('entity_id', eventId);
    expect(logs).toContainEqual(expect.objectContaining({ entity: 'event', before: { status: 'in_progress' }, after: { status: 'final' } }));
    expect(logs!.some((l) => l.entity === 'points_awards' && (l.after as { action: string }).action === 'finalize')).toBe(true);

    // Override, reopen (audited), finalize again: the override stays, everything else recomputed.
    data(await overridePoints(eventId, runnerUp, 321.25));
    data(await setEventStatus(eventId, 'in_progress'));
    data(await finalizeEvent(eventId));
    const { data: after } = await admin.from('points_awards').select('player_id, points, override').eq('event_id', eventId);
    expect(after).toHaveLength(6);
    expect(after!.find((r) => r.player_id === runnerUp)).toMatchObject({ points: 321.25, override: true });
    expect(Number(after!.find((r) => r.player_id === champion)!.points)).toBe(500);
  });

  it('a real player session reads the standings (RLS hides draft-event awards)', async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const link = await admin.from('players').update({ user_id: userId }).eq('id', viewer);
    if (link.error) throw link.error;
    const user = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;

    // RLS: the draft event's award row is invisible to a player.
    const { data: hidden } = await user.from('points_awards').select('id').eq('event_id', draftId);
    expect(hidden).toEqual([]);

    h.server = user;
    h.me = { id: viewer, is_commissioner: false };
    const rows = data(await getStandings(seasonId));
    const mine = rows.filter((r) => r.byEvent.some((b) => b.eventId === eventId));
    expect(mine).toHaveLength(6);
    const champ = mine.find((r) => r.byEvent.some((b) => b.eventId === eventId && b.points === 500))!;
    expect(champ.name).toMatch(/\S/);
    expect(champ.byEvent.find((b) => b.eventId === eventId)!.eventName).toBe(`INT points ${stamp}`);
    expect(rows.every((r) => r.byEvent.every((b) => b.eventId !== draftId))).toBe(true);
    expect(rows.find((r) => r.playerId === viewer)).toBeUndefined(); // player07 did not advance, draft award hidden
    // Ranked: positions non-decreasing with totals descending; top 8 qualify.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.total).toBeLessThanOrEqual(rows[i - 1]!.total);
    expect(rows.filter((r) => r.qualified).every((r) => r.position <= 8)).toBe(true);
  });
});
