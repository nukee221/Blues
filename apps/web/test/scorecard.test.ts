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
import type { ActionResult } from '@/lib/actionResult';
import { REJECT, SC } from '@/lib/scorecardCodes';

/** The data of a successful result (fails the test otherwise). */
function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.data;
}
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);

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
        scorer_self_claimed: false,
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
    data(await openGroup(CODE));
    const c = h.jar.get('hgt_dev')!;
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, path: '/' });
    const again = c.value;
    data(await openGroup(CODE));
    expect(h.jar.get('hgt_dev')!.value).toBe(again);
  });

  it('returns the group view without code or device token', async () => {
    h.db.tables.scores!.push({ id: 's1', group_id: GROUP, player_id: P[0], hole: 2, gross: 5, client_ts: ts(1) });
    const view = data(await openGroup(CODE));
    expect(view).toMatchObject({ groupId: GROUP, locked: false, isScorerDevice: false, kind: 'stroke', handicapMode: 'net' });
    expect(view.players).toEqual([
      { id: P[0], name: NAMES[0], playingHandicap: 10, withdrawn: false },
      { id: P[1], name: NAMES[1], playingHandicap: 3, withdrawn: false },
      { id: P[2], name: NAMES[2], playingHandicap: 0, withdrawn: false },
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
    expect(data(await openGroup(' abc 234 ')).groupId).toBe(GROUP);
    const spy = vi.spyOn(h.db, 'from');
    expect(codeOf(await openGroup('ABC10I'))).toBe(SC.invalidCode);
    expect(codeOf(await openGroup('ABC23'))).toBe(SC.invalidCode);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns not_found for an unknown code', async () => {
    expect(codeOf(await openGroup('ZZZ999'))).toBe(SC.notFound);
  });

  it('reports isScorerDevice for the scorer device', async () => {
    seed(scorer());
    h.jar.set('hgt_dev', { value: DEV_A });
    expect(data(await openGroup(CODE)).isScorerDevice).toBe(true);
    h.jar.set('hgt_dev', { value: DEV_B });
    const view = data(await openGroup(CODE));
    expect(view.isScorerDevice).toBe(false);
    expect(view.hasScorerDevice).toBe(true);
  });

  it('places extra-hole scores of a match round after the 18 holes', async () => {
    seed({}, { kind: 'match' });
    h.db.tables.scores!.push({ id: 's19', group_id: GROUP, player_id: P[0], hole: 19, gross: 4, client_ts: ts(1) });
    const view = data(await openGroup(CODE));
    expect(view.scores[P[0]!]).toHaveLength(19);
    expect(view.scores[P[0]!]![18]).toBe(4);
    expect(view.scores[P[1]!]).toHaveLength(19);
  });
});

describe('claimScorer', () => {
  it('makes this device the scorer when nobody holds it and records the player', async () => {
    h.jar.set('hgt_dev', { value: DEV_A });
    data(await claimScorer(CODE, P[1]!));
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[1], scorer_device_token: DEV_A, scorer_self_claimed: true });
  });
  it('sets the device cookie if absent', async () => {
    data(await claimScorer(CODE, P[1]!));
    expect(h.db.tables.groups![0]!.scorer_device_token).toBe(h.jar.get('hgt_dev')!.value);
  });
  it('requires the commissioner-assigned scorer when one is preset', async () => {
    seed({ scorer_player_id: P[0] });
    h.jar.set('hgt_dev', { value: DEV_A });
    const r = await claimScorer(CODE, P[1]!);
    expect(codeOf(r)).toBe(SC.presetScorer);
    expect(!r.ok && r.error).toContain(NAMES[0]); // display text names the assigned scorer
    data(await claimScorer(CODE, P[0]!));
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[0], scorer_device_token: DEV_A, scorer_self_claimed: false });
  });
  it('refuses when another device already holds it', async () => {
    seed(scorer());
    h.jar.set('hgt_dev', { value: DEV_B });
    expect(codeOf(await claimScorer(CODE, P[0]!))).toBe(SC.otherDevice);
  });
  it('refuses a player who is not in the group', async () => {
    h.jar.set('hgt_dev', { value: DEV_A });
    expect(codeOf(await claimScorer(CODE, OUTSIDER))).toBe(SC.notInGroup);
  });
  it('refuses on a signed card', async () => {
    seed({ locked: true });
    expect(codeOf(await claimScorer(CODE, P[0]!))).toBe(SC.locked);
  });
  it('a self-claimed scorer is not reported as commissioner-assigned: after a release another player may claim', async () => {
    h.jar.set('hgt_dev', { value: DEV_A });
    data(await claimScorer(CODE, P[0]!)); // nobody preset: P0 claims
    data(await releaseScorer(GROUP));
    h.jar.set('hgt_dev', { value: DEV_B });
    const r = await claimScorer(CODE, P[1]!);
    expect(codeOf(r)).toBe('ok');
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[1], scorer_device_token: DEV_B, scorer_self_claimed: true });
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
    data(await releaseScorer(GROUP));
    expect(h.db.tables.groups![0]).toMatchObject({ scorer_player_id: P[0], scorer_device_token: null });
    expect(h.db.tables.audit_log).toHaveLength(1);
    expect(h.db.tables.audit_log![0]).toMatchObject({ actor_player_id: P[3], entity: 'group', entity_id: GROUP });
    expect(JSON.stringify(h.db.tables.audit_log)).not.toContain(DEV_A);
    // a new phone can now claim
    h.jar.set('hgt_dev', { value: DEV_B });
    data(await claimScorer(CODE, P[0]!));
    expect(h.db.tables.groups![0]!.scorer_device_token).toBe(DEV_B);
  });
  it('refuses a locked or signed group', async () => {
    seed({ ...scorer(), locked: true });
    expect(codeOf(await releaseScorer(GROUP))).toBe(SC.locked);
    seed({ ...scorer(), signed_at: ts(30) });
    expect(codeOf(await releaseScorer(GROUP))).toBe(SC.locked);
    expect(h.db.tables.groups![0]!.scorer_device_token).toBe(DEV_A);
    expect(h.db.tables.audit_log).toHaveLength(0);
  });
  it('returns locked and writes no audit row when the card is signed between the read and the update', async () => {
    seed(scorer());
    const orig = h.db.from.bind(h.db);
    let first = true;
    vi.spyOn(h.db, 'from').mockImplementation((t: string) => {
      const b = orig(t) as Record<string, unknown>;
      if (t === 'groups' && first) {
        first = false;
        const read = b.maybeSingle as () => Promise<unknown>;
        b.maybeSingle = async () => {
          const r = await read();
          h.db.tables.groups![0]!.locked = true; // signed concurrently
          return r;
        };
      }
      return b as ReturnType<typeof orig>;
    });
    expect(codeOf(await releaseScorer(GROUP))).toBe(SC.locked);
    expect(h.db.tables.groups![0]!.scorer_device_token).toBe(DEV_A);
    expect(h.db.tables.audit_log).toHaveLength(0);
  });
  it('returns not_found for an unknown group', async () => {
    expect(codeOf(await releaseScorer('55555555-5555-4555-8555-000000000000'))).toBe(SC.notFound);
  });
});

describe('saveScores', () => {
  beforeEach(() => {
    seed(scorer());
    h.jar.set('hgt_dev', { value: DEV_A });
  });
  const one = (over: Record<string, unknown> = {}) => ({ playerId: P[0]!, hole: 1, gross: 5, clientTs: ts(1), ...over });

  it('writes scores from the scorer device', async () => {
    expect(data(await saveScores(CODE, [one(), one({ playerId: P[1]!, gross: 4 })]))).toEqual({ accepted: 2, rejected: [] });
    expect(scores()).toHaveLength(2);
    expect(scores()[0]).toMatchObject({ group_id: GROUP, player_id: P[0], hole: 1, gross: 5, client_ts: ts(1) });
  });

  it('non-scorer device is read-only', async () => {
    h.jar.set('hgt_dev', { value: DEV_B });
    expect(codeOf(await saveScores(CODE, [one()]))).toBe(SC.notScorer);
    h.jar.delete('hgt_dev');
    expect(codeOf(await saveScores(CODE, [one()]))).toBe(SC.notScorer);
    expect(scores()).toHaveLength(0);
  });

  it('older client_ts does not overwrite newer score', async () => {
    data(await saveScores(CODE, [one({ hole: 3, clientTs: ts(10) })]));
    expect(data(await saveScores(CODE, [one({ hole: 3, gross: 7, clientTs: ts(5) })]))).toEqual({ accepted: 0, rejected: [] });
    expect(scores()).toHaveLength(1);
    expect(scores()[0]).toMatchObject({ gross: 5, client_ts: ts(10) });
    data(await saveScores(CODE, [one({ hole: 3, gross: 6, clientTs: ts(12) })]));
    expect(scores()[0]).toMatchObject({ gross: 6, client_ts: ts(12) });
  });

  it('keeps the newest of duplicate entries within one batch', async () => {
    data(await saveScores(CODE, [one({ hole: 4, gross: 6, clientTs: ts(9) }), one({ hole: 4, gross: 4, clientTs: ts(3) })]));
    expect(scores()).toHaveLength(1);
    expect(scores()[0]).toMatchObject({ gross: 6 });
  });

  it('saveScores on a locked group is refused (locked)', async () => {
    seed({ ...scorer(), locked: true });
    expect(codeOf(await saveScores(CODE, [one()]))).toBe(SC.locked);
    seed({ ...scorer(), signed_at: ts(30) });
    expect(codeOf(await saveScores(CODE, [one()]))).toBe(SC.locked);
    expect(scores()).toHaveLength(0);
  });

  it('gross 0 or 16 rejected, per entry, without blocking the rest of the batch', async () => {
    const r = data(
      await saveScores(CODE, [
        one({ hole: 1, gross: 0 }),
        one({ hole: 2, gross: 16 }),
        one({ hole: 3, gross: 4.5 }),
        one({ hole: 4, gross: 15 }),
        one({ hole: 5, gross: 1 }),
      ]),
    );
    expect(r.accepted).toBe(2);
    expect(r.rejected).toEqual([
      { playerId: P[0], hole: 1, reason: REJECT.badGross },
      { playerId: P[0], hole: 2, reason: REJECT.badGross },
      { playerId: P[0], hole: 3, reason: REJECT.badGross },
    ]);
    expect(scores().map((s) => s.hole).sort()).toEqual([4, 5]);
  });

  it('rejects, per entry, a player outside the group, a hole the tee does not have, and garbage', async () => {
    const r1 = data(await saveScores(CODE, [one({ playerId: OUTSIDER }), one({ hole: 2 })]));
    expect(r1).toEqual({ accepted: 1, rejected: [{ playerId: OUTSIDER, hole: 1, reason: REJECT.notInGroup }] });
    h.getTeeInfo.mockResolvedValue({ rating: 35, slope: 120, par: 36, holes: holes18.slice(0, 9) });
    const r2 = data(await saveScores(CODE, [one({ hole: 10 }), { nonsense: true } as never]));
    expect(r2.accepted).toBe(0);
    expect(r2.rejected.map((x) => x.reason)).toEqual([REJECT.badHole, REJECT.invalid]);
    expect(scores()).toHaveLength(1);
  });

  it('stroke round rejects hole 19; match round accepts it (tee hole 1)', async () => {
    expect(data(await saveScores(CODE, [one({ hole: 19 })])).rejected).toEqual([
      { playerId: P[0], hole: 19, reason: REJECT.noExtraHoles },
    ]);
    expect(scores()).toHaveLength(0);
    seed(scorer(), { kind: 'match' });
    expect(data(await saveScores(CODE, [one({ hole: 19 }), one({ hole: 36 })]))).toEqual({ accepted: 2, rejected: [] });
    expect(data(await saveScores(CODE, [one({ hole: 37 })])).rejected[0]!.reason).toBe(REJECT.invalid);
    expect(scores().map((s) => s.hole)).toEqual([19, 36]);
  });

  it('clamps a future client_ts to server now', async () => {
    const before = Date.now();
    data(await saveScores(CODE, [one({ clientTs: '2099-01-01T00:00:00.000Z' })]));
    const stored = Date.parse(String(scores()[0]!.client_ts));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it('rejects a malformed code before any DB call', async () => {
    const spy = vi.spyOn(h.db, 'from');
    expect(codeOf(await saveScores('nope', [one()]))).toBe(SC.invalidCode);
    expect(spy).not.toHaveBeenCalled();
  });
});
