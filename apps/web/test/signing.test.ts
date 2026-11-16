import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createFakeDb } from './fakeDb';

/**
 * Signing actions against the in-memory fake. The Postgres functions of 0004 are
 * stood in for by `rpc` below (same contract: SQLSTATEs, return values; the fake lockout
 * has the first 10-minute block only); their real behaviour, the lockout window and its
 * escalation (0005) included, is covered by supabase/tests/signing.test.sql
 * and test/integration/signing.int.test.ts.
 */
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>,
  jar: new Map<string, string>(),
  requireUser: vi.fn(),
  requireCommissioner: vi.fn(),
  getTeeInfo: vi.fn(),
  rpc: vi.fn(),
  serverFrom: vi.fn(),
  /** ms added to "now" inside the fake pin functions. */
  skew: 0,
  /** When set, writes to scores fail as the lock trigger would. */
  triggerLocked: false,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      const b = h.db.from(t) as Record<string, (...a: unknown[]) => unknown>;
      if (t !== 'scores' || !h.triggerLocked) return b;
      const refuse = () => ({
        ...b,
        select: () => refuse(),
        eq: () => refuse(),
        lt: () => refuse(),
        is: () => refuse(),
        then: (res: (v: unknown) => unknown) => Promise.resolve(res({ data: null, error: { code: 'HGLCK', message: 'card_locked' } })),
      });
      return { ...b, insert: () => refuse(), update: () => refuse() };
    },
    rpc: (fn: string, args: Row) => h.rpc(fn, args),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: (t: string) => h.serverFrom(t) }) }));
vi.mock('@/lib/auth', () => ({ requireUser: h.requireUser, requireCommissioner: h.requireCommissioner }));
vi.mock('@/lib/courses', () => ({ getTeeInfo: h.getTeeInfo }));

import { adminEditScore, adminSignCard, reopenCard, setPin, signCard } from '@/actions/signing';
import { saveScores } from '@/actions/scorecard';
import type { ActionResult } from '@/lib/actionResult';
import { SC } from '@/lib/scorecardCodes';
import { SG } from '@/lib/signingCodes';

function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r.data;
}
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);

const EVENT = '11111111-1111-4111-8111-111111111111';
const ROUND = '22222222-2222-4222-8222-222222222222';
const TEE = '33333333-3333-4333-8333-333333333333';
const GROUP = '55555555-5555-4555-8555-555555555555';
const P = Array.from({ length: 4 }, (_, i) => `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`);
const [A, B, C, COMMISH] = P as [string, string, string, string];
const NAMES = ['Alex Turner', 'Blake Morgan', 'Casey Reynolds', 'Drew Patterson'];
const CODE = 'ABC234';
const DEV = 'A'.repeat(43);
const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const PINS: Record<string, string> = { [A]: '1234', [B]: '5678', [C]: '0000' };
const hashes: Record<string, string> = {};

beforeAll(async () => {
  for (const [id, pin] of Object.entries(PINS)) hashes[id] = await bcrypt.hash(pin, 4);
});

// ---------------------------------------------------------------------------
// Fake 0004 functions
// ---------------------------------------------------------------------------
const pgError = (code: string, message = code) => ({ data: null, error: { code, message } });
const nowMs = () => Date.now() + h.skew;
const TEN_MIN = 10 * 60 * 1000;

function fakeRpc(fn: string, a: Row) {
  const t = h.db.tables;
  const group = () => t.groups!.find((g) => g.id === a.p_group);
  const member = () => t.group_players!.some((m) => m.group_id === a.p_group && m.player_id === a.p_player);
  if (fn === 'pin_attempt_begin') {
    const fails = t.pin_attempts!
      .filter((x) => x.player_id === a.p_player && !x.success)
      .map((x) => Date.parse(String(x.attempted_at)));
    const blocked = fails.some((f) => f > nowMs() - TEN_MIN && fails.filter((w) => w <= f && w >= f - TEN_MIN).length >= 5);
    if (blocked) return { data: null, error: null };
    const id = `att-${t.pin_attempts!.length + 1}`;
    t.pin_attempts!.push({ id, player_id: a.p_player, attempted_at: new Date(nowMs()).toISOString(), success: false });
    return { data: id, error: null };
  }
  if (fn === 'pin_attempt_succeeded') {
    const row = t.pin_attempts!.find((x) => x.id === a.p_attempt);
    if (row) row.success = true;
    return { data: null, error: null };
  }
  if (fn === 'sign_card' || fn === 'admin_sign_card') {
    const g = group();
    if (!g) return pgError('HGNFD');
    if (g.locked || g.signed_at) return pgError('HGLCK');
    if (!member()) return pgError('HGNIG');
    if (a.p_role === 'scorer' && g.scorer_player_id !== a.p_player) return pgError('HGROL');
    if (a.p_role === 'attest' && g.scorer_player_id === a.p_player) return pgError('HGSAM');
    const sigs = t.signatures!.filter((s) => s.group_id === a.p_group);
    if (sigs.some((s) => s.player_id === a.p_player && s.role !== a.p_role)) return pgError('HGSAM');
    const same = sigs.find((s) => s.role === a.p_role);
    if (same && same.player_id !== a.p_player) return pgError('23505');
    if (!same) t.signatures!.push({ id: `sig-${t.signatures!.length + 1}`, group_id: a.p_group, player_id: a.p_player, role: a.p_role, signed_at: new Date().toISOString() });
    const locked = new Set(t.signatures!.filter((s) => s.group_id === a.p_group).map((s) => s.role)).size === 2;
    if (locked) Object.assign(g, { locked: true, signed_at: new Date().toISOString() });
    if (fn === 'admin_sign_card') {
      t.audit_log!.push({ actor_player_id: a.p_actor, entity: 'signature', entity_id: a.p_group, before: null, after: { player_id: a.p_player, role: a.p_role, on_behalf: true, locked } });
    }
    return { data: locked, error: null };
  }
  if (fn === 'admin_edit_score') {
    if (!group()) return pgError('HGNFD');
    if (!member()) return pgError('HGNIG');
    const row = t.scores!.find((s) => s.group_id === a.p_group && s.player_id === a.p_player && s.hole === a.p_hole);
    const before = row ? { group_id: a.p_group, player_id: a.p_player, hole: a.p_hole, gross: row.gross } : null;
    if (row) row.gross = a.p_gross;
    else t.scores!.push({ id: `s-${t.scores!.length + 1}`, group_id: a.p_group, player_id: a.p_player, hole: a.p_hole, gross: a.p_gross });
    t.audit_log!.push({ actor_player_id: a.p_actor, entity: 'score', before, after: { group_id: a.p_group, player_id: a.p_player, hole: a.p_hole, gross: a.p_gross } });
    return { data: null, error: null };
  }
  if (fn === 'reopen_card') {
    const g = group();
    if (!g) return pgError('HGNFD');
    const sigs = t.signatures!.filter((s) => s.group_id === a.p_group);
    if (!g.locked && !g.signed_at && sigs.length === 0) return pgError('HGNLK');
    t.signatures = t.signatures!.filter((s) => s.group_id !== a.p_group);
    const before = { locked: g.locked, signed_at: g.signed_at, signatures: sigs.map((s) => ({ player_id: s.player_id, role: s.role })) };
    Object.assign(g, { locked: false, signed_at: null });
    t.audit_log!.push({ actor_player_id: a.p_actor, entity: 'group', entity_id: a.p_group, before, after: { locked: false, signed_at: null, signatures: [], reason: a.p_reason, action: 'reopen' } });
    return { data: null, error: null };
  }
  throw new Error(`unexpected rpc ${fn}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function seed({ kind = 'stroke', members = [A, B, C], pins = true }: { kind?: 'stroke' | 'match'; members?: string[]; pins?: boolean } = {}) {
  h.db = createFakeDb({
    events: [{ id: EVENT, name: 'Spring Opener', handicap_mode: 'net', match_strokes: 'full' }],
    rounds: [{ id: ROUND, event_id: EVENT, round_number: 1, tee_id: TEE, kind }],
    groups: [
      { id: GROUP, round_id: ROUND, code: CODE, start_hole: 1, scorer_player_id: A, scorer_device_token: DEV, scorer_self_claimed: false, locked: false, signed_at: null },
    ],
    group_players: members.map((id, i) => ({ id: `gp-${i}`, group_id: GROUP, player_id: id, playing_handicap: 0 })),
    players: P.map((id, i) => ({ id, name: NAMES[i], email: `p${i}@example.test`, pin_hash: pins ? (hashes[id] ?? null) : null })),
    scores: [],
    signatures: [],
    audit_log: [],
    pin_attempts: [],
  });
}

/** Gross for `player` on holes 1..n (or the given list). */
function score(player: string, grosses: number[], startHole = 1) {
  grosses.forEach((gross, i) =>
    h.db.tables.scores!.push({ id: `s-${player}-${startHole + i}`, group_id: GROUP, player_id: player, hole: startHole + i, gross, client_ts: null }),
  );
}
const all4 = () => Array<number>(18).fill(4);
function completeStroke() {
  for (const p of [A, B, C]) score(p, all4());
}
const sigs = () => h.db.tables.signatures!.filter((s) => s.group_id === GROUP);
const grp = () => h.db.tables.groups!.find((g) => g.id === GROUP)!;

beforeEach(() => {
  vi.clearAllMocks();
  h.jar.clear();
  h.skew = 0;
  h.triggerLocked = false;
  h.getTeeInfo.mockResolvedValue({ rating: 71, slope: 130, par: 72, holes: holes18 });
  h.rpc.mockImplementation(async (fn: string, a: Row) => fakeRpc(fn, a));
  h.serverFrom.mockImplementation((t: string) => h.db.from(t));
  h.requireUser.mockResolvedValue({ userId: 'u-a', player: { id: A, is_commissioner: false } });
  h.requireCommissioner.mockResolvedValue({ userId: 'u-d', player: { id: COMMISH, is_commissioner: true } });
  seed();
});

// ---------------------------------------------------------------------------
describe('setPin', () => {
  it('stores a cost-10 bcrypt hash of exactly 4 digits on the caller’s own row, via the user client', async () => {
    data(await setPin('4321'));
    const row = h.db.tables.players!.find((p) => p.id === A)!;
    expect(String(row.pin_hash)).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare('4321', String(row.pin_hash))).toBe(true);
    expect(h.serverFrom).toHaveBeenCalledWith('players');
    expect(h.db.tables.players!.find((p) => p.id === B)!.pin_hash).toBe(hashes[B]);
  });

  it.each(['123', '12345', 'abcd', '12a4', '', ' 1234'])('rejects %j with code invalid', async (pin) => {
    expect(codeOf(await setPin(pin))).toBe(SG.invalid);
    expect(h.db.writes).toHaveLength(0);
  });

  it('requires a signed-in player (redirect stays outside the result)', async () => {
    h.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/login'));
    await expect(setPin('1234')).rejects.toThrow('NEXT_REDIRECT:/login');
  });
});

// ---------------------------------------------------------------------------
describe('signCard', () => {
  it('wrong PIN is rejected and signs nothing', async () => {
    completeStroke();
    expect(codeOf(await signCard(CODE, A, '9999', 'scorer'))).toBe(SG.wrongPin);
    expect(sigs()).toHaveLength(0);
    expect(h.db.tables.pin_attempts).toEqual([expect.objectContaining({ player_id: A, success: false })]);
  });

  it('a malformed PIN is invalid and does not count as an attempt', async () => {
    completeStroke();
    expect(codeOf(await signCard(CODE, A, '12', 'scorer'))).toBe(SG.invalid);
    expect(h.db.tables.pin_attempts).toHaveLength(0);
  });

  it('only the group’s scorer signs as scorer', async () => {
    completeStroke();
    expect(codeOf(await signCard(CODE, B, PINS[B]!, 'scorer'))).toBe(SG.notGroupScorer);
    expect(sigs()).toHaveLength(0);
  });

  it('the scorer cannot sign as attester (attester same as scorer is rejected)', async () => {
    completeStroke();
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'attest'))).toBe(SG.sameAsScorer);
    data(await signCard(CODE, A, PINS[A]!, 'scorer'));
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'attest'))).toBe(SG.sameAsScorer);
    expect(sigs()).toHaveLength(1);
    expect(grp().locked).toBe(false);
  });

  it('a player outside the group cannot sign', async () => {
    completeStroke();
    expect(codeOf(await signCard(CODE, COMMISH, '1111', 'attest'))).toBe(SG.notInGroup);
  });

  it('an attest role already signed by someone else is refused', async () => {
    completeStroke();
    data(await signCard(CODE, B, PINS[B]!, 'attest'));
    expect(codeOf(await signCard(CODE, C, PINS[C]!, 'attest'))).toBe(SG.alreadySigned);
  });

  it('incomplete stroke card is rejected before any PIN check', async () => {
    for (const p of [A, B]) score(p, all4());
    score(C, Array<number>(17).fill(4)); // C missing hole 18
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'scorer'))).toBe(SG.incomplete);
    expect(h.db.tables.pin_attempts).toHaveLength(0);
    expect(sigs()).toHaveLength(0);
  });

  it('both signatures lock the card; the attester signs from any device', async () => {
    completeStroke();
    h.jar.set('hgt_dev', DEV);
    expect(data(await signCard(CODE, A, PINS[A]!, 'scorer'))).toEqual({ locked: false });
    expect(grp().locked).toBe(false);
    h.jar.clear(); // attester's own phone, no scorer cookie
    expect(data(await signCard(CODE, B, PINS[B]!, 'attest'))).toEqual({ locked: true });
    expect(grp()).toMatchObject({ locked: true });
    expect(grp().signed_at).toEqual(expect.any(String));
    expect(sigs().map((s) => [s.role, s.player_id])).toEqual([
      ['scorer', A],
      ['attest', B],
    ]);
    expect(h.rpc).toHaveBeenCalledWith('sign_card', { p_group: GROUP, p_player: B, p_role: 'attest' });
    expect(codeOf(await signCard(CODE, C, PINS[C]!, 'attest'))).toBe(SG.locked);
  });

  it('saveScores after lock returns code locked', async () => {
    completeStroke();
    data(await signCard(CODE, A, PINS[A]!, 'scorer'));
    data(await signCard(CODE, B, PINS[B]!, 'attest'));
    h.jar.set('hgt_dev', DEV);
    const r = await saveScores(CODE, [{ playerId: A, hole: 1, gross: 3, clientTs: new Date().toISOString() }]);
    expect(codeOf(r)).toBe(SC.locked);
    expect(h.db.tables.scores!.find((s) => s.player_id === A && s.hole === 1)!.gross).toBe(4);
  });

  it('saveScores maps the lock trigger (signed between read and write) to code locked', async () => {
    h.jar.set('hgt_dev', DEV);
    h.triggerLocked = true;
    const insert = await saveScores(CODE, [{ playerId: A, hole: 1, gross: 3, clientTs: new Date().toISOString() }]);
    expect(codeOf(insert)).toBe(SC.locked);
    h.triggerLocked = false;
    score(A, [5]);
    h.triggerLocked = true;
    const update = await saveScores(CODE, [{ playerId: A, hole: 1, gross: 3, clientTs: new Date().toISOString() }]);
    expect(codeOf(update)).toBe(SC.locked);
  });

  it('player with no PIN gets code no_pin (and nothing is recorded)', async () => {
    seed({ pins: false });
    completeStroke();
    expect(codeOf(await signCard(CODE, A, '1234', 'scorer'))).toBe(SG.noPin);
    expect(h.db.tables.pin_attempts).toHaveLength(0);
  });

  it('6th PIN within 10 minutes is blocked even if correct; a success is not a failure; the block lifts after 10 minutes', async () => {
    completeStroke();
    for (let i = 0; i < 4; i++) expect(codeOf(await signCard(CODE, B, '0001', 'attest'))).toBe(SG.wrongPin);
    expect(codeOf(await signCard(CODE, B, '0001', 'attest'))).toBe(SG.wrongPin); // 5th failure
    expect(codeOf(await signCard(CODE, B, PINS[B]!, 'attest'))).toBe(SG.pinLocked); // 6th, correct
    expect(sigs()).toHaveLength(0);
    // Other players are unaffected.
    expect(data(await signCard(CODE, A, PINS[A]!, 'scorer'))).toEqual({ locked: false });
    h.skew = 9 * 60 * 1000;
    expect(codeOf(await signCard(CODE, B, PINS[B]!, 'attest'))).toBe(SG.pinLocked);
    h.skew = 10 * 60 * 1000 + 1000;
    expect(data(await signCard(CODE, B, PINS[B]!, 'attest'))).toEqual({ locked: true });
    expect(h.db.tables.pin_attempts!.filter((x) => x.player_id === B).map((x) => x.success)).toEqual([false, false, false, false, false, true]);
  });

  it('a blocked attempt never compares the PIN', async () => {
    completeStroke();
    h.rpc.mockImplementation(async (fn: string, a: Row) => (fn === 'pin_attempt_begin' ? { data: null, error: null } : fakeRpc(fn, a)));
    const spy = vi.spyOn(bcrypt, 'compare');
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'scorer'))).toBe(SG.pinLocked);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an unknown code is not_found; a bad role or player id is invalid', async () => {
    expect(codeOf(await signCard('ZZZ999', A, '1234', 'scorer'))).toBe(SG.notFound);
    expect(codeOf(await signCard(CODE, A, '1234', 'boss' as 'scorer'))).toBe(SG.invalid);
    expect(codeOf(await signCard(CODE, 'nope', '1234', 'scorer'))).toBe(SG.invalid);
  });
});

describe('signCard in match rounds', () => {
  const win = () => {
    // A wins hole 1, then all halved: A 1 UP after 18.
    score(A, [3, ...Array<number>(17).fill(4)]);
    score(B, all4());
  };

  it('the opponent attests; the card locks when the match is decided', async () => {
    seed({ kind: 'match', members: [A, B] });
    win();
    data(await signCard(CODE, A, PINS[A]!, 'scorer'));
    expect(data(await signCard(CODE, B, PINS[B]!, 'attest'))).toEqual({ locked: true });
  });

  it('an attester from the scorer’s side (no defined opponent) is rejected', async () => {
    seed({ kind: 'match', members: [A, B, C] });
    win();
    score(C, all4());
    expect(codeOf(await signCard(CODE, C, PINS[C]!, 'attest'))).toBe(SG.notOpponent);
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'attest'))).toBe(SG.sameAsScorer);
  });

  it('an undecided match is incomplete; all square after 18 is all_square; an extra-hole win completes it', async () => {
    seed({ kind: 'match', members: [A, B] });
    score(A, Array<number>(10).fill(4));
    score(B, Array<number>(10).fill(4));
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'scorer'))).toBe(SG.incomplete);

    seed({ kind: 'match', members: [A, B] });
    score(A, all4());
    score(B, all4());
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'scorer'))).toBe(SG.allSquare);
    score(A, [4], 19);
    score(B, [5], 19);
    expect(data(await signCard(CODE, A, PINS[A]!, 'scorer'))).toEqual({ locked: false });
  });

  it('a match card with no scorer is no_scorer, before the opponent check', async () => {
    seed({ kind: 'match', members: [A, B] });
    h.db.tables.groups![0]!.scorer_player_id = null;
    score(A, [3, ...Array<number>(17).fill(4)]);
    score(B, all4());
    expect(codeOf(await signCard(CODE, B, PINS[B]!, 'attest'))).toBe(SG.noScorer);
    expect(codeOf(await signCard(CODE, A, PINS[A]!, 'scorer'))).toBe(SG.noScorer);
    expect(h.db.tables.pin_attempts).toHaveLength(0);
  });

  it('a match decided early (3&2) is complete without the last holes', async () => {
    seed({ kind: 'match', members: [A, B] });
    score(A, [3, 3, 3, ...Array<number>(13).fill(4)]);
    score(B, Array<number>(16).fill(4));
    expect(data(await signCard(CODE, A, PINS[A]!, 'scorer'))).toEqual({ locked: false });
  });
});

// ---------------------------------------------------------------------------
describe('reopenCard', () => {
  async function lock() {
    completeStroke();
    data(await signCard(CODE, A, PINS[A]!, 'scorer'));
    data(await signCard(CODE, B, PINS[B]!, 'attest'));
  }

  it('clears signatures, unlocks, writes an audit row with the reason; saveScores then works', async () => {
    await lock();
    data(await reopenCard(GROUP, 'Wrong score on 7'));
    expect(sigs()).toHaveLength(0);
    expect(grp()).toMatchObject({ locked: false, signed_at: null });
    expect(h.rpc).toHaveBeenCalledWith('reopen_card', { p_group: GROUP, p_actor: COMMISH, p_reason: 'Wrong score on 7' });
    expect(h.db.tables.audit_log).toContainEqual(
      expect.objectContaining({ actor_player_id: COMMISH, entity: 'group', entity_id: GROUP, after: expect.objectContaining({ locked: false, reason: 'Wrong score on 7' }) }),
    );
    h.jar.set('hgt_dev', DEV);
    expect(data(await saveScores(CODE, [{ playerId: A, hole: 7, gross: 5, clientTs: new Date().toISOString() }]))).toEqual({ accepted: 1, rejected: [] });
  });

  it('requires a reason of at least 3 characters', async () => {
    await lock();
    for (const reason of ['', '  ', 'ab', ' a ']) expect(codeOf(await reopenCard(GROUP, reason))).toBe(SG.invalid);
    expect(grp().locked).toBe(true);
  });

  it('an unsigned card is not_signed; an unknown group is not_found', async () => {
    expect(codeOf(await reopenCard(GROUP, 'reason'))).toBe(SG.notSigned);
    expect(codeOf(await reopenCard('99999999-9999-4999-8999-999999999999', 'reason'))).toBe(SG.notFound);
  });

  it('is commissioner-only (the redirect stays outside the result)', async () => {
    h.requireCommissioner.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(reopenCard(GROUP, 'reason')).rejects.toThrow('NEXT_REDIRECT:/forbidden');
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('adminEditScore', () => {
  it('edits a locked card through admin_edit_score with the actor; audit has before/after', async () => {
    completeStroke();
    data(await signCard(CODE, A, PINS[A]!, 'scorer'));
    data(await signCard(CODE, B, PINS[B]!, 'attest'));
    data(await adminEditScore(GROUP, C, 7, 6));
    expect(h.rpc).toHaveBeenCalledWith('admin_edit_score', { p_group: GROUP, p_player: C, p_hole: 7, p_gross: 6, p_actor: COMMISH });
    expect(h.db.tables.scores!.find((s) => s.player_id === C && s.hole === 7)!.gross).toBe(6);
    expect(h.db.tables.audit_log).toContainEqual(
      expect.objectContaining({ entity: 'score', actor_player_id: COMMISH, before: expect.objectContaining({ gross: 4 }), after: expect.objectContaining({ gross: 6 }) }),
    );
  });

  it('validates gross 1–15, holes on the tee (19+ only in match rounds) and membership', async () => {
    expect(codeOf(await adminEditScore(GROUP, A, 1, 0))).toBe(SG.invalid);
    expect(codeOf(await adminEditScore(GROUP, A, 1, 16))).toBe(SG.invalid);
    expect(codeOf(await adminEditScore(GROUP, A, 1, 4.5))).toBe(SG.invalid);
    expect(codeOf(await adminEditScore(GROUP, A, 0, 4))).toBe(SG.invalid);
    expect(codeOf(await adminEditScore(GROUP, A, 19, 4))).toBe(SG.invalid);
    expect(codeOf(await adminEditScore(GROUP, COMMISH, 1, 4))).toBe(SG.notInGroup);
    expect(h.rpc).not.toHaveBeenCalled();
    seed({ kind: 'match', members: [A, B] });
    data(await adminEditScore(GROUP, A, 19, 4));
  });
});

describe('adminSignCard', () => {
  it('signs on a player’s behalf without a PIN (even with no PIN set), with an audit row', async () => {
    seed({ pins: false });
    completeStroke();
    expect(data(await adminSignCard(GROUP, A, 'scorer'))).toEqual({ locked: false });
    expect(data(await adminSignCard(GROUP, B, 'attest'))).toEqual({ locked: true });
    expect(h.rpc).toHaveBeenCalledWith('admin_sign_card', { p_group: GROUP, p_player: B, p_role: 'attest', p_actor: COMMISH });
    expect(h.db.tables.audit_log!.filter((x) => x.entity === 'signature')).toHaveLength(2);
    expect(h.db.tables.pin_attempts).toHaveLength(0);
  });

  it('applies the same role and completeness rules', async () => {
    expect(codeOf(await adminSignCard(GROUP, A, 'scorer'))).toBe(SG.incomplete);
    completeStroke();
    expect(codeOf(await adminSignCard(GROUP, B, 'scorer'))).toBe(SG.notGroupScorer);
    expect(codeOf(await adminSignCard(GROUP, A, 'attest'))).toBe(SG.sameAsScorer);
    expect(h.db.tables.audit_log).toHaveLength(0);
  });
});
