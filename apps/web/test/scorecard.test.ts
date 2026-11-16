import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeDb';

type CookieOpts = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>,
  jar: new Map<string, { value: string; opts?: CookieOpts }>(),
  requireCommissioner: vi.fn(),
  getTeeInfo: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: CookieOpts) => void h.jar.set(name, { value, opts }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => h.db.from(t) }) }));
vi.mock('@/lib/auth', () => ({ requireCommissioner: h.requireCommissioner }));
vi.mock('@/lib/courses', () => ({ getTeeInfo: h.getTeeInfo }));

import { claimScorer, openGroup, releaseScorer, saveScores } from '@/actions/scorecard';

const EVENT = '11111111-1111-4111-8111-111111111111';
const ROUND = '22222222-2222-4222-8222-222222222222';
const TEE = '33333333-3333-4333-8333-333333333333';
const GROUP = '55555555-5555-4555-8555-555555555555';
const P = Array.from({ length: 4 }, (_, i) => `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`);
const NAMES = ['Alex Turner', 'Blake Morgan', 'Casey Reynolds', 'Drew Patterson'];
const OUTSIDER = '44444444-4444-4444-8444-000000000099';
const CODE = 'ABC234';
const DEV_A = 'A'.repeat(43);
const DEV_B = 'B'.repeat(43);
const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i % 3 === 0 ? 5 : 4, strokeIndex: i + 1 }));
const ts = (min: number) => new Date(Date.UTC(2026, 10, 1, 15, min)).toISOString();

function seed(group: Record<string, unknown> = {}, round: Record<string, unknown> = {}) {
  h.db = createFakeDb({
    events: [{ id: EVENT, name: 'Spring Opener', handicap_mode: 'net', match_strokes: 'full' }],
    rounds: [{ id: ROUND, event_id: EVENT, round_number: 1, tee_id: TEE, kind: 'stroke', ...round }],
    groups: [
      {
        id: GROUP,
        round_id: ROUND,
        code: CODE,
        start_hole: 1,
        scorer_player_id: null,
        scorer_device_token: null,
        locked: false,
        signed_at: null,
        ...group,
      },
    ],
    group_players: P.slice(0, 3).map((id, i) => ({ id: `gp-${i}`, group_id: GROUP, player_id: id, index_snapshot: 10, playing_handicap: [10, 3, 0][i] })),
    players: [...P, OUTSIDER].map((id, i) => ({ id, name: NAMES[i] ?? 'Outsider', email: `p${i}@example.test` })),
    scores: [],
    audit_log: [],
  });
}
const scorer = (playerId = P[0]!) => ({ scorer_player_id: playerId, scorer_device_token: DEV_A });
const scores = () => h.db.tables.scores!;

beforeEach(() => {
  vi.clearAllMocks();
  h.jar.clear();
  h.getTeeInfo.mockResolvedValue({ rating: 71.8, slope: 140, par: 75, holes: holes18 });
  h.requireCommissioner.mockResolvedValue({ userId: 'u', player: { id: P[3] } });
  seed();
});

describe('openGroup', () => {
  it('sets an httpOnly lax hgt_dev cookie (32 random bytes, 1 year) when absent', async () => {
    await openGroup(CODE);
    const c = h.jar.get('hgt_dev')!;
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, path: '/' });
    const again = c.value;
    await openGroup(CODE);
    expect(h.jar.get('hgt_dev')!.value).toBe(again);
  });

  it('returns the group view without code or device token', async () => {
    h.db.tables.scores!.push({ id: 's1', group_id: GROUP, player_id: P[0], hole: 2, gross: 5, client_ts: ts(1) });
    const view = await openGroup(CODE);
    expect(view).toMatchObject({ groupId: GROUP, locked: false, isScorerDevice: false, kind: 'stroke', handicapMode: 'net' });
    expect(view.players).toEqual([
      { id: P[0], name: NAMES[0], playingHandicap: 10 },
      { id: P[1], name: NAMES[1], playingHandicap: 3 },
      { id: P[2], name: NAMES[2], playingHandicap: 0 },
    ]);
    expect(view.holes).toHaveLength(18);
    expect(view.scores[P[0]!]).toHaveLength(18);
    expect(view.scores[P[0]!]![1]).toBe(5);
    expect(view.scores[P[1]!]![1]).toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain(CODE);
    expect(json).not.toContain('scorer_device_token');
  });

  it('normalizes the code (case, whitespace) and rejects a malformed one before any DB call', async () => {
    await expect(openGroup(' abc 234 ')).resolves.toMatchObject({ groupId: GROUP });
    const spy = vi.spyOn(h.db, 'from');
    await expect(openGroup('ABC10I')).rejects.toThrow(/not a valid code/i);
    await expect(openGroup('ABC23')).rejects.toThrow(/not a valid code/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws for an unknown code', async () => {
    await expect(openGroup('ZZZ999')).rejects.toThrow(/no group has that code/i);
  });

  it('reports isScorerDevice for the scorer device', async () => {
    seed(scorer());
    h.jar.set('hgt_dev', { value: DEV_A });
    expect((await openGroup(CODE)).isScorerDevice).toBe(true);
    h.jar.set('hgt_dev', { value: DEV_B });
    const view = await openGroup(CODE);
    expect(view.isScorerDevice).toBe(false);
    expect(view.hasScorerDevice).toBe(true);
  });
});

describe('claimScorer', () => {
  it('makes this device the scorer when nobody holds it and records the player', async () => {
    h.jar.set('hgt_dev', { value: DEV_A });
    await claimScorer(CODE, P[1]!);
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[1], scorer_device_token: DEV_A });
  });
  it('sets the device cookie if absent', async () => {
    await claimScorer(CODE, P[1]!);
    expect(h.db.tables.groups![0]!.scorer_device_token).toBe(h.jar.get('hgt_dev')!.value);
  });
  it('requires the commissioner-assigned scorer when one is preset', async () => {
    seed({ scorer_player_id: P[0] });
    h.jar.set('hgt_dev', { value: DEV_A });
    await expect(claimScorer(CODE, P[1]!)).rejects.toThrow('The commissioner assigned Alex Turner as scorer');
    await claimScorer(CODE, P[0]!);
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[0], scorer_device_token: DEV_A });
  });
  it('refuses when another device already holds it', async () => {
    seed(scorer());
    h.jar.set('hgt_dev', { value: DEV_B });
    await expect(claimScorer(CODE, P[0]!)).rejects.toThrow('Another phone is already keeping score for this group');
  });
  it('refuses a player who is not in the group', async () => {
    h.jar.set('hgt_dev', { value: DEV_A });
    await expect(claimScorer(CODE, OUTSIDER)).rejects.toThrow(/not in this group/i);
  });
  it('refuses on a signed card', async () => {
    seed({ locked: true });
    await expect(claimScorer(CODE, P[0]!)).rejects.toThrow('Card is signed');
  });
});

describe('releaseScorer', () => {
  it('requires a commissioner before any DB call', async () => {
    h.requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    const spy = vi.spyOn(h.db, 'from');
    await expect(releaseScorer(GROUP)).rejects.toThrow(/forbidden/);
    expect(spy).not.toHaveBeenCalled();
  });
  it('clears the scorer device (keeping the scorer player) and audits', async () => {
    seed(scorer());
    await releaseScorer(GROUP);
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[0], scorer_device_token: null });
    expect(h.db.tables.audit_log).toHaveLength(1);
    expect(h.db.tables.audit_log![0]).toMatchObject({ actor_player_id: P[3], entity: 'group', entity_id: GROUP });
    expect(JSON.stringify(h.db.tables.audit_log)).not.toContain(DEV_A);
    // a new phone can now claim
    h.jar.set('hgt_dev', { value: DEV_B });
    await claimScorer(CODE, P[0]!);
    expect(h.db.tables.groups![0]!.scorer_device_token).toBe(DEV_B);
  });
});

describe('saveScores', () => {
  beforeEach(() => {
    seed(scorer());
    h.jar.set('hgt_dev', { value: DEV_A });
  });

  it('writes scores from the scorer device', async () => {
    await expect(
      saveScores(CODE, [
        { playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1) },
        { playerId: P[1]!, hole: 1, gross: 4, clientTs: ts(1) },
      ]),
    ).resolves.toEqual({ accepted: 2 });
    expect(scores()).toHaveLength(2);
    expect(scores()[0]).toMatchObject({ group_id: GROUP, player_id: P[0], hole: 1, gross: 5, client_ts: ts(1) });
  });

  it('non-scorer device is read-only', async () => {
    h.jar.set('hgt_dev', { value: DEV_B });
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1) }])).rejects.toThrow(
      'Only the scorer can enter scores',
    );
    h.jar.delete('hgt_dev');
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1) }])).rejects.toThrow(
      'Only the scorer can enter scores',
    );
    expect(scores()).toHaveLength(0);
  });

  it('older client_ts does not overwrite newer score', async () => {
    await saveScores(CODE, [{ playerId: P[0]!, hole: 3, gross: 5, clientTs: ts(10) }]);
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 3, gross: 7, clientTs: ts(5) }])).resolves.toEqual({ accepted: 0 });
    expect(scores()).toHaveLength(1);
    expect(scores()[0]).toMatchObject({ gross: 5, client_ts: ts(10) });
    await saveScores(CODE, [{ playerId: P[0]!, hole: 3, gross: 6, clientTs: ts(12) }]);
    expect(scores()[0]).toMatchObject({ gross: 6, client_ts: ts(12) });
  });

  it('keeps the newest of duplicate entries within one batch', async () => {
    await saveScores(CODE, [
      { playerId: P[0]!, hole: 4, gross: 6, clientTs: ts(9) },
      { playerId: P[0]!, hole: 4, gross: 4, clientTs: ts(3) },
    ]);
    expect(scores()).toHaveLength(1);
    expect(scores()[0]).toMatchObject({ gross: 6 });
  });

  it('saveScores on a locked group throws "Card is signed"', async () => {
    seed({ ...scorer(), locked: true });
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1) }])).rejects.toThrow('Card is signed');
    seed({ ...scorer(), signed_at: ts(30) });
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1) }])).rejects.toThrow('Card is signed');
    expect(scores()).toHaveLength(0);
  });

  it('gross 0 or 16 rejected', async () => {
    for (const gross of [0, 16, 4.5]) {
      await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross, clientTs: ts(1) }])).rejects.toThrow();
    }
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross: 15, clientTs: ts(1) }])).resolves.toEqual({ accepted: 1 });
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 2, gross: 1, clientTs: ts(1) }])).resolves.toEqual({ accepted: 1 });
    expect(scores()).toHaveLength(2);
  });

  it('rejects a player outside the group and a hole the tee does not have', async () => {
    await expect(saveScores(CODE, [{ playerId: OUTSIDER, hole: 1, gross: 5, clientTs: ts(1) }])).rejects.toThrow(/not in this group/i);
    h.getTeeInfo.mockResolvedValue({ rating: 35, slope: 120, par: 36, holes: holes18.slice(0, 9) });
    await expect(saveScores(CODE, [{ playerId: P[0]!, hole: 10, gross: 5, clientTs: ts(1) }])).rejects.toThrow(/hole 10/i);
    expect(scores()).toHaveLength(0);
  });

  it('clamps a future client_ts to server now', async () => {
    const before = Date.now();
    await saveScores(CODE, [{ playerId: P[0]!, hole: 1, gross: 5, clientTs: '2099-01-01T00:00:00.000Z' }]);
    const stored = Date.parse(String(scores()[0]!.client_ts));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it('rejects a malformed code before any DB call', async () => {
    const spy = vi.spyOn(h.db, 'from');
    await expect(saveScores('nope', [{ playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1) }])).rejects.toThrow(/not a valid code/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
