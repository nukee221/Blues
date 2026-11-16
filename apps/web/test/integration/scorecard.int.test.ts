import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// Real tables via the service role; only the cookie jar (which device is calling) is stubbed.
const h = vi.hoisted(() => ({ admin: null as unknown, jar: new Map<string, string>() }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
  }),
}));
vi.mock('@/lib/auth', () => ({ requireCommissioner: async () => ({ userId: 'u', player: { id: null } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.admin }));

import { claimScorer, openGroup, saveScores } from '@/actions/scorecard';
import { generateGroupCode } from '@/lib/codes';
import type { ActionResult } from '@/lib/actionResult';
import { REJECT, SC } from '@/lib/scorecardCodes';

function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.data;
}
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);

const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
h.admin = admin;

const stamp = Date.now();
const code = generateGroupCode();
let eventId: string;
let groupId: string;
let players: string[] = [];

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id').limit(1).single();
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT scorecard ${stamp}`, event_type: 'regular', status: 'in_progress', handicap_mode: 'net' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: round, error: rErr } = await admin
    .from('rounds')
    .insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, kind: 'stroke' })
    .select('id')
    .single();
  if (rErr) throw rErr;
  const { data: group, error: gErr } = await admin.from('groups').insert({ round_id: round!.id, code }).select('id').single();
  if (gErr) throw gErr;
  groupId = group!.id;
  const { data: ps } = await admin
    .from('players')
    .select('id')
    .in('email', ['player10@example.test', 'player11@example.test'])
    .order('email');
  players = (ps ?? []).map((p) => p.id);
  const gp = await admin.from('group_players').insert(players.map((p, i) => ({ group_id: groupId, player_id: p, playing_handicap: 5 + i })));
  if (gp.error) throw gp.error;
});

afterAll(async () => {
  if (eventId) await admin.from('events').delete().eq('id', eventId); // cascades rounds, groups, scores
});

const ts = (min: number) => new Date(Date.UTC(2026, 10, 1, 15, min)).toISOString();

describe('scorecard against local Supabase', () => {
  it('scorer device saves (last write wins); a second device is refused', async () => {
    h.jar.clear();
    const first = data(await openGroup(code.toLowerCase()));
    expect(first).toMatchObject({ groupId, isScorerDevice: false, hasScorerDevice: false, kind: 'stroke' });
    expect(first.holes).toHaveLength(18);
    const deviceA = h.jar.get('hgt_dev')!;
    expect(deviceA).toMatch(/^[A-Za-z0-9_-]{43}$/);

    data(await claimScorer(code, players[0]!));
    expect(data(await openGroup(code)).isScorerDevice).toBe(true);

    expect(
      data(
        await saveScores(code, [
          { playerId: players[0]!, hole: 1, gross: 5, clientTs: ts(10) },
          { playerId: players[1]!, hole: 1, gross: 4, clientTs: ts(10) },
          { playerId: players[1]!, hole: 19, gross: 4, clientTs: ts(10) }, // stroke round: no extra holes
        ]),
      ),
    ).toEqual({ accepted: 2, rejected: [{ playerId: players[1], hole: 19, reason: REJECT.noExtraHoles }] });
    // Older edit from a queued entry does not win; newer does.
    expect(data(await saveScores(code, [{ playerId: players[0]!, hole: 1, gross: 7, clientTs: ts(5) }]))).toEqual({ accepted: 0, rejected: [] });
    expect(data(await saveScores(code, [{ playerId: players[1]!, hole: 1, gross: 3, clientTs: ts(12) }]))).toEqual({ accepted: 1, rejected: [] });

    const { data: rows } = await admin.from('scores').select('player_id, hole, gross').eq('group_id', groupId).order('player_id');
    expect(rows).toEqual(
      expect.arrayContaining([
        { player_id: players[0], hole: 1, gross: 5 },
        { player_id: players[1], hole: 1, gross: 3 },
      ]),
    );
    expect(rows).toHaveLength(2);

    // Second phone.
    h.jar.clear();
    const view = data(await openGroup(code));
    expect(h.jar.get('hgt_dev')).not.toBe(deviceA);
    expect(view).toMatchObject({ isScorerDevice: false, hasScorerDevice: true });
    expect(view.scores[players[0]!]![0]).toBe(5);
    expect(codeOf(await saveScores(code, [{ playerId: players[0]!, hole: 2, gross: 4, clientTs: ts(20) }]))).toBe(SC.notScorer);
    expect(codeOf(await claimScorer(code, players[1]!))).toBe(SC.otherDevice);
    const { data: after } = await admin.from('scores').select('id').eq('group_id', groupId);
    expect(after).toHaveLength(2);
    const { data: g } = await admin.from('groups').select('scorer_player_id, scorer_device_token').eq('id', groupId).single();
    expect(g).toEqual({ scorer_player_id: players[0], scorer_device_token: deviceA });
  });

  it('a match round stores extra hole 19 (migration 0003) and shows it after the 18', async () => {
    await admin.from('rounds').update({ kind: 'match' }).eq('event_id', eventId);
    h.jar.clear();
    data(await openGroup(code));
    await admin.from('groups').update({ scorer_device_token: null }).eq('id', groupId); // hand-off for the test
    data(await claimScorer(code, players[0]!));
    expect(data(await saveScores(code, [{ playerId: players[0]!, hole: 19, gross: 4, clientTs: ts(30) }]))).toEqual({ accepted: 1, rejected: [] });
    const view = data(await openGroup(code));
    expect(view.kind).toBe('match');
    expect(view.scores[players[0]!]![18]).toBe(4);
    const { data: row } = await admin.from('scores').select('gross').eq('group_id', groupId).eq('hole', 19).single();
    expect(row).toEqual({ gross: 4 });
  });
});
