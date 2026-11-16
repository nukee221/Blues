import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strokePlayLeaderboard, type PlayerCard, type TeeInfo } from '@hgt/scoring';
import { createFakeDb } from './fakeDb';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.db }));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ userId: 'u', player: { id: 'p1' } }) }));

const tee: TeeInfo = vi.hoisted(() => ({
  rating: 72,
  slope: 113,
  par: 72,
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
}));
vi.mock('@/lib/courses', () => ({ getTeeInfo: async () => tee }));

import { getRoundLeaderboard } from '@/actions/leaderboard';
import { formatPos, formatThru, formatToPar } from '@/lib/leaderboardFormat';

const R = '00000000-0000-4000-8000-0000000000a1';
const E = 'e1';

/** n players p1..pn, one group g1; scores[i] = list of gross per hole for player i+1. */
function seed(opts: { status?: string; format?: string; mode?: string | null; roundNumber?: number; registered?: number; locked?: boolean; scores: Record<string, number[]>; hcp?: Record<string, number>; extra?: { player_id: string; hole: number; gross: number }[] }) {
  const ids = Object.keys(opts.scores);
  const scoreRows = ids.flatMap((p) => opts.scores[p]!.map((gross, i) => ({ group_id: 'g1', player_id: p, hole: i + 1, gross })));
  return createFakeDb({
    rounds: [{ id: R, event_id: E, round_number: opts.roundNumber ?? 1, tee_id: 't1' }],
    events: [{ id: E, name: 'Opener', format: opts.format ?? 'match_play', status: opts.status ?? 'in_progress', handicap_mode: opts.mode === undefined ? 'net' : opts.mode }],
    groups: [{ id: 'g1', round_id: R, locked: opts.locked ?? false }],
    group_players: ids.map((p) => ({ group_id: 'g1', player_id: p, playing_handicap: opts.hcp?.[p] ?? 0 })),
    scores: [...scoreRows, ...(opts.extra ?? []).map((x) => ({ group_id: 'g1', ...x }))],
    registrations: Array.from({ length: opts.registered ?? 0 }, (_, i) => ({ event_id: E, player_id: `x${i}`, status: 'registered' })),
    public_players: ids.map((p) => ({ id: p, name: `Name ${p}` })),
  });
}
const full = (g: number) => Array(18).fill(g) as number[];

describe('getRoundLeaderboard', () => {
  beforeEach(() => void (h.db = null));

  it('matches strokePlayLeaderboard built from the same fixtures (net, extra holes ignored)', async () => {
    const scores = { p1: full(4), p2: full(5), p3: [4, 4, 4, 4, 4], p4: full(4) };
    const hcp = { p1: 0, p2: 18, p3: 0, p4: 0 };
    h.db = seed({ scores, hcp, extra: [{ player_id: 'p1', hole: 19, gross: 9 }] });
    const r = await getRoundLeaderboard(R);
    if (!r.ok) throw new Error(r.error);
    const cards: PlayerCard[] = Object.entries(scores).map(([playerId, g]) => ({
      playerId,
      playing: hcp[playerId as keyof typeof hcp],
      gross: Array.from({ length: 18 }, (_, i) => g[i] ?? null),
    }));
    const expected = strokePlayLeaderboard(cards, tee, 'net');
    expect(r.data.rows.map(({ name, signed, advancing, ...row }) => row)).toEqual(expected);
    expect(r.data.rows[0]!.name).toBe(`Name ${expected[0]!.playerId}`);
    expect(r.data.mode).toBe('net');
    expect(r.data.eventName).toBe('Opener');
    expect(r.data.roundNumber).toBe(1);
  });

  it('uses gross standings when the event is gross', async () => {
    h.db = seed({ mode: 'gross', scores: { p1: full(5), p2: full(4) }, hcp: { p1: 18, p2: 0 } });
    const r = await getRoundLeaderboard(R);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.mode).toBe('gross');
    expect(r.data.rows.map((x) => x.playerId)).toEqual(['p2', 'p1']);
  });

  it('12 registered in a match-play round 1 -> cutLine 6', async () => {
    h.db = seed({ registered: 12, scores: { p1: full(4) } });
    const r = await getRoundLeaderboard(R);
    expect(r.ok && r.data.cutLine).toBe(6);
  });

  it('16 registered -> cutLine 8; withdrawn registrations are not counted', async () => {
    h.db = seed({ registered: 16, scores: { p1: full(4) } });
    const a = await getRoundLeaderboard(R);
    expect(a.ok && a.data.cutLine).toBe(8);
    const db = seed({ registered: 16, scores: { p1: full(4) } });
    db.tables.registrations![0]!.status = 'withdrawn'; // 15 registered
    h.db = db;
    const b = await getRoundLeaderboard(R);
    expect(b.ok && b.data.cutLine).toBe(6);
  });

  it('no cut line for round 2 or a non-match-play event', async () => {
    h.db = seed({ registered: 12, roundNumber: 2, scores: { p1: full(4) } });
    const a = await getRoundLeaderboard(R);
    expect(a.ok && a.data.cutLine).toBeNull();
    h.db = seed({ registered: 12, format: 'stroke_play', scores: { p1: full(4) } });
    const b = await getRoundLeaderboard(R);
    expect(b.ok && b.data.cutLine).toBeNull();
  });

  it('marks advancing only once everyone has finished 18', async () => {
    const scores: Record<string, number[]> = {};
    for (let i = 1; i <= 8; i++) scores[`p${i}`] = full(3 + i); // distinct, p1 best
    h.db = seed({ registered: 12, scores });
    const done = await getRoundLeaderboard(R);
    if (!done.ok) throw new Error(done.error);
    expect(done.data.rows.filter((x) => x.advancing).map((x) => x.playerId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);

    scores.p8 = [4, 4, 4];
    h.db = seed({ registered: 12, scores });
    const mid = await getRoundLeaderboard(R);
    if (!mid.ok) throw new Error(mid.error);
    expect(mid.data.rows.some((x) => x.advancing)).toBe(false);
    expect(mid.data.cutLine).toBe(6);
  });

  it('signed reflects the locked group', async () => {
    h.db = seed({ locked: true, scores: { p1: full(4) } });
    const r = await getRoundLeaderboard(R);
    expect(r.ok && r.data.rows[0]!.signed).toBe(true);
  });

  it('draft event -> not_found; missing round -> not_found', async () => {
    h.db = seed({ status: 'draft', scores: { p1: full(4) } });
    const r = await getRoundLeaderboard(R);
    expect(r).toMatchObject({ ok: false, code: 'not_found' });
    h.db = seed({ scores: { p1: full(4) } });
    expect(await getRoundLeaderboard('00000000-0000-4000-8000-0000000000a2')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await getRoundLeaderboard('not-a-uuid-at-all')).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('leaderboard formatting', () => {
  it('prefixes ties with T', () => {
    expect(formatPos(1, false)).toBe('1');
    expect(formatPos(2, true)).toBe('T2');
  });
  it('formats to-par', () => {
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(3)).toBe('+3');
    expect(formatToPar(-2)).toBe('−2');
  });
  it('formats thru', () => {
    expect(formatThru(0)).toBe('-');
    expect(formatThru(7)).toBe('7');
    expect(formatThru(18)).toBe('F');
  });
});
