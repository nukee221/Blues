import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawBracket, type Bracket } from '@hgt/scoring';
import { createFakeDb } from './fakeDb';

/**
 * Bracket actions against the in-memory fake. The signing RPCs (0004) are stood in for by
 * a minimal `rpc` (sign_card / admin_sign_card / reopen_card). The real tables and functions
 * are covered by test/integration/bracket.int.test.ts.
 */
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>,
  requireUser: vi.fn(),
  requireCommissioner: vi.fn(),
  getTeeInfo: vi.fn(),
  /** Next N guarded brackets updates lose to a simulated concurrent writer (who runs `onConflict`). */
  conflicts: 0,
  onConflict: null as null | (() => void),
  /** Tables whose next insert fails. */
  failInsert: new Set<string>(),
  mailer: null as unknown as { sent: { to: string; subject: string; html: string }[]; send: unknown; sendBatch: (m: unknown[]) => Promise<void> },
}));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => faulty(t), rpc: async (fn: string, a: Row) => fakeRpc(fn, a) }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: (t: string) => h.db.from(t) }) }));
vi.mock('@/lib/auth', () => ({ requireUser: h.requireUser, requireCommissioner: h.requireCommissioner }));
vi.mock('@/lib/courses', () => ({ getTeeInfo: h.getTeeInfo }));
vi.mock('@/lib/mailer', async (orig) => {
  const actual = await orig<typeof import('@/lib/mailer')>();
  return { ...actual, getMailer: () => h.mailer };
});

import { awardForfeit, closePlayIn, createMatchCard, drawEventBracket, finalizeMatch, getBracketView, setRoundDeadline } from '@/actions/bracket';
import { describeMatch, roundName } from '@/lib/bracketView';
import { formatShortDate } from '@/lib/time';
import { adminEditScore, adminSignCard, reopenCard } from '@/actions/signing';
import { createFakeMailer } from '@/lib/mailer';
import { cryptoRng, clearWinner, resultLabel } from '@/lib/bracketState';
import type { ActionResult } from '@/lib/actionResult';

function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r.data;
}
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);

const EVENT = '11111111-1111-4111-8111-111111111111';
const ROUND1 = '22222222-2222-4222-8222-222222222222';
const TEE = '33333333-3333-4333-8333-333333333333';
const TEE2 = '33333333-3333-4333-8333-333333333334';
const BRACKET = '66666666-6666-4666-8666-666666666666';
const P = Array.from({ length: 12 }, (_, i) => `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`);
const COMMISH = '44444444-4444-4444-8444-0000000000cc';
const OUTSIDER = '44444444-4444-4444-8444-0000000000dd';
const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const tee = { rating: 72, slope: 113, par: 72, holes: holes18 };

/** h.db.from with fault injection (concurrent bracket writers, failed inserts). */
function faulty(t: string) {
  const b = h.db.from(t) as Record<string, (...a: unknown[]) => unknown>;
  if (t === 'brackets' && h.conflicts > 0) {
    const update = b.update!;
    b.update = (arg: unknown) => {
      if (h.conflicts > 0) {
        h.conflicts--;
        h.onConflict?.();
        for (const r of h.db.tables.brackets!) r.version = Number(r.version) + 1;
      }
      return update(arg);
    };
  }
  if (h.failInsert.has(t)) {
    b.insert = () => {
      h.failInsert.delete(t);
      const error = { code: 'XX000', message: `insert into ${t} failed` };
      const e: Record<string, unknown> = {
        select: () => e,
        single: async () => ({ data: null, error }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(res({ data: null, error })),
      };
      return e;
    };
  }
  return b;
}

// ---------------------------------------------------------------------------
// Fake 0004 functions (contract only)
// ---------------------------------------------------------------------------
function fakeRpc(fn: string, a: Row) {
  const t = h.db.tables;
  const g = t.groups!.find((x) => x.id === a.p_group);
  if (fn === 'sign_card' || fn === 'admin_sign_card') {
    if (!g) return { data: null, error: { code: 'HGNFD', message: 'nf' } };
    if (g.locked) return { data: null, error: { code: 'HGLCK', message: 'locked' } };
    t.signatures!.push({ id: `sig-${t.signatures!.length}`, group_id: a.p_group, player_id: a.p_player, role: a.p_role, signed_at: new Date().toISOString() });
    const locked = new Set(t.signatures!.filter((s) => s.group_id === a.p_group).map((s) => s.role)).size === 2;
    if (locked) Object.assign(g, { locked: true, signed_at: new Date().toISOString() });
    return { data: locked, error: null };
  }
  if (fn === 'admin_edit_score') {
    const row = t.scores!.find((x) => x.group_id === a.p_group && x.player_id === a.p_player && x.hole === a.p_hole);
    if (row) row.gross = a.p_gross;
    else t.scores!.push({ id: `e-${t.scores!.length}`, group_id: a.p_group, player_id: a.p_player, hole: a.p_hole, gross: a.p_gross });
    return { data: null, error: null };
  }
  if (fn === 'reopen_card') {
    if (!g) return { data: null, error: { code: 'HGNFD', message: 'nf' } };
    t.signatures = t.signatures!.filter((s) => s.group_id !== a.p_group);
    Object.assign(g, { locked: false, signed_at: null });
    t.audit_log!.push({ actor_player_id: a.p_actor, entity: 'group', entity_id: a.p_group, after: { action: 'reopen' } });
    return { data: null, error: null };
  }
  throw new Error(`unexpected rpc ${fn}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NAME = (i: number) => `Player ${String.fromCharCode(65 + i)}`; // Player A, Player B, ...

function baseTables(registered: number): Record<string, Row[]> {
  return {
    events: [{ id: EVENT, name: 'Match Play Opener', format: 'match_play', status: 'in_progress', handicap_mode: 'gross', allowance_pct: 100, handicap_basis: 'index', match_strokes: 'full' }],
    rounds: [{ id: ROUND1, event_id: EVENT, round_number: 1, tee_id: TEE, play_date: '2027-03-01', kind: 'stroke' }],
    tees: [
      { id: TEE, name: 'White', course_id: 'c1' },
      { id: TEE2, name: 'Blue', course_id: 'c1' },
    ],
    courses: [{ id: 'c1', name: 'Hampton Cove' }],
    players: [
      ...P.map((id, i) => ({ id, name: NAME(i), email: `p${i}@example.test`, handicap_index: i % 3 })),
      { id: COMMISH, name: 'Zed Commish', email: 'c@example.test', handicap_index: 5 },
      { id: OUTSIDER, name: 'Zoe Outside', email: 'o@example.test', handicap_index: 5 },
    ],
    public_players: [...P.map((id, i) => ({ id, name: NAME(i) }))],
    registrations: P.slice(0, registered).map((id, i) => ({ id: `reg-${i}`, event_id: EVENT, player_id: id, status: 'registered' })),
    groups: [],
    group_players: [],
    scores: [],
    signatures: [],
    brackets: [],
    bracket_matches: [],
    audit_log: [],
  };
}

function makeDb(tables: Record<string, Row[]>) {
  h.db = createFakeDb(
    tables,
    { groups: ['code'], brackets: ['event_id'] },
    { rounds: [['groups', 'round_id']], groups: [['group_players', 'group_id'], ['scores', 'group_id'], ['signatures', 'group_id']] },
  );
}

/** 12 registered; play-in groups of 4, all signed; player i shoots 72 + i (gross) unless `totals` says otherwise. */
function seedPlayIn(opts: { totals?: number[]; unsignedGroup?: number; withdrawn?: string[] } = {}) {
  const t = baseTables(12);
  for (let g = 0; g < 3; g++) {
    t.groups!.push({ id: `g${g}`, round_id: ROUND1, start_hole: 1, locked: opts.unsignedGroup !== g, signed_at: null, code: `CODE${g}` });
    for (let k = 0; k < 4; k++) {
      const i = g * 4 + k;
      t.group_players!.push({ id: `gp${i}`, group_id: `g${g}`, player_id: P[i], playing_handicap: 0, withdrawn: opts.withdrawn?.includes(P[i]!) ?? false });
      const total = opts.totals?.[i] ?? 72 + i;
      for (let hole = 1; hole <= 18; hole++) {
        t.scores!.push({ id: `s${i}-${hole}`, group_id: `g${g}`, player_id: P[i], hole, gross: hole <= total - 72 ? 5 : 4 });
      }
    }
  }
  makeDb(t);
}

/** A drawn 4-player bracket (no byes) of P0..P3, stored as closePlayIn + drawEventBracket would. */
function seedDrawn(players = P.slice(0, 4)): Bracket {
  const t = baseTables(12);
  for (const p of t.players!) p.handicap_index = 0; // scratch: match results follow gross
  const bracket = drawBracket(players, () => 0.5);
  t.brackets!.push({ id: BRACKET, event_id: EVENT, size: bracket.size, rounds: bracket.rounds, version: 0, state: { advanced: players, bracket } });
  t.bracket_matches = bracket.matches.map((m) => ({ id: `bm-${m.id}`, bracket_id: BRACKET, match_key: m.id, round: m.round, deadline: null, group_id: null, result: null, forfeit: false }));
  makeDb(t);
  return bracket;
}

const bracketRow = () => h.db.tables.brackets!.find((b) => b.event_id === EVENT)!;
const stateOf = () => bracketRow().state as { advanced: string[]; bracket: Bracket | null };
const matchOf = (key: string) => stateOf().bracket!.matches.find((m) => m.id === key)!;
const bmOf = (key: string) => h.db.tables.bracket_matches!.find((m) => m.match_key === key)!;
const audits = (action: string) => h.db.tables.audit_log!.filter((a) => (a.after as Row | null)?.action === action);

/** Gross per hole for the two players of a card: `win` wins holes 1..up (3 vs 4), then all 4s. */
function scoreCard(groupId: string, win: string, lose: string, opts: { up?: number; holes?: number; extra?: [number, number][] } = {}) {
  const up = opts.up ?? 3;
  for (let hole = 1; hole <= (opts.holes ?? 18); hole++) {
    h.db.tables.scores!.push({ id: `${groupId}-${win}-${hole}`, group_id: groupId, player_id: win, hole, gross: hole <= up ? 3 : 4 });
    h.db.tables.scores!.push({ id: `${groupId}-${lose}-${hole}`, group_id: groupId, player_id: lose, hole, gross: 4 });
  }
  (opts.extra ?? []).forEach(([w, l], k) => {
    h.db.tables.scores!.push({ id: `${groupId}-${win}-x${k}`, group_id: groupId, player_id: win, hole: 19 + k, gross: w });
    h.db.tables.scores!.push({ id: `${groupId}-${lose}-x${k}`, group_id: groupId, player_id: lose, hole: 19 + k, gross: l });
  });
}
const lock = (groupId: string) => Object.assign(h.db.tables.groups!.find((g) => g.id === groupId)!, { locked: true, signed_at: new Date().toISOString() });

function asPlayer(id: string, commissioner = false) {
  h.requireUser.mockResolvedValue({ userId: `u-${id}`, player: { id, is_commissioner: commissioner } });
}

/** Commissioner starts the card for `key` and returns its group id. */
async function cardFor(key: string): Promise<string> {
  asPlayer(COMMISH, true);
  data(await createMatchCard(EVENT, key, null, '2027-03-02'));
  return bmOf(key).group_id as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.conflicts = 0;
  h.onConflict = null;
  h.failInsert.clear();
  process.env.APP_URL = 'https://tour.example.test/';
  h.mailer = createFakeMailer() as typeof h.mailer;
  h.getTeeInfo.mockResolvedValue(tee);
  h.requireCommissioner.mockResolvedValue({ userId: 'u-c', player: { id: COMMISH, is_commissioner: true } });
  asPlayer(P[0]!);
});

// ---------------------------------------------------------------------------
describe('closePlayIn', () => {
  it('12 registered, every play-in card signed -> the top 6 advance; brackets row and audit written', async () => {
    seedPlayIn();
    expect(data(await closePlayIn(EVENT))).toEqual({ advanced: P.slice(0, 6) });
    expect(bracketRow()).toMatchObject({ size: 8, rounds: 3, state: { advanced: P.slice(0, 6), bracket: null } });
    expect(audits('close_play_in')).toEqual([expect.objectContaining({ actor_player_id: COMMISH, entity: 'bracket', entity_id: bracketRow().id })]);
  });

  it('a tie for 6th returns needsTiebreak; the commissioner’s pick then advances 6', async () => {
    const totals = P.map((_, i) => 72 + i);
    totals[6] = totals[5]!; // P5 and P6 tie for 6th
    seedPlayIn({ totals });
    expect(data(await closePlayIn(EVENT))).toEqual({ needsTiebreak: { spots: 1, playerIds: [P[5], P[6]] } });
    expect(h.db.tables.brackets).toHaveLength(0);
    // Wrong count or a player outside the tie: asked again.
    expect(data(await closePlayIn(EVENT, [P[7]!]))).toEqual({ needsTiebreak: { spots: 1, playerIds: [P[5], P[6]] } });
    expect(data(await closePlayIn(EVENT, [P[5]!, P[6]!]))).toMatchObject({ needsTiebreak: expect.anything() });
    const done = data(await closePlayIn(EVENT, [P[6]!]));
    expect(done).toEqual({ advanced: [...P.slice(0, 5), P[6]] });
    expect(stateOf().advanced).toHaveLength(6);
  });

  it('an unsigned card -> cards_unsigned with the count, nothing written', async () => {
    seedPlayIn({ unsignedGroup: 1 });
    const r = await closePlayIn(EVENT);
    expect(r).toMatchObject({ ok: false, code: 'cards_unsigned' });
    expect(!r.ok && r.error).toMatch(/All play-in cards must be signed: 1 card not signed/);
    expect(h.db.writes).toHaveLength(0);
  });

  it('withdrawn players are ignored by the cut, and a card of only withdrawn players need not be signed', async () => {
    seedPlayIn({ unsignedGroup: 2, withdrawn: [P[0]!, P[8]!, P[9]!, P[10]!, P[11]!] });
    expect(data(await closePlayIn(EVENT))).toEqual({ advanced: P.slice(1, 7) });
  });

  it('refuses a second close, a stroke event, an event not in progress; commissioner only', async () => {
    seedPlayIn();
    data(await closePlayIn(EVENT));
    expect(codeOf(await closePlayIn(EVENT))).toBe('already_closed');
    seedPlayIn();
    h.db.tables.events![0]!.format = 'stroke';
    expect(codeOf(await closePlayIn(EVENT))).toBe('not_match_play');
    h.db.tables.events![0]!.format = 'match_play';
    h.db.tables.events![0]!.status = 'final';
    expect(codeOf(await closePlayIn(EVENT))).toBe('wrong_status');
    h.requireCommissioner.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(closePlayIn(EVENT)).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });
});

// ---------------------------------------------------------------------------
describe('drawEventBracket', () => {
  it('6 advancers -> an 8-bracket with 2 byes pre-advanced, persisted, with a bracket_matches row per match', async () => {
    seedPlayIn();
    data(await closePlayIn(EVENT));
    const bracket = data(await drawEventBracket(EVENT));
    expect(bracket).toMatchObject({ size: 8, rounds: 3 });
    expect(stateOf().bracket).toEqual(bracket);
    expect(bracketRow().version).toBe(1);
    const byes = bracket.matches.filter((m) => m.isBye);
    expect(byes).toHaveLength(2);
    for (const b of byes) {
      expect(b.winner).not.toBeNull();
      const next = bracket.matches.find((x) => x.round === 2 && x.slot === Math.ceil(b.slot / 2))!;
      expect([next.a, next.b]).toContain(b.winner);
    }
    expect(new Set(bracket.matches.filter((m) => m.round === 1).flatMap((m) => [m.a, m.b]).filter(Boolean))).toEqual(new Set(P.slice(0, 6)));
    expect(h.db.tables.bracket_matches!.map((m) => [m.match_key, m.round]).sort()).toEqual(
      [['R1M1', 1], ['R1M2', 1], ['R1M3', 1], ['R1M4', 1], ['R2M1', 2], ['R2M2', 2], ['R3M1', 3]],
    );
    expect(audits('draw')).toHaveLength(1);
  });

  it('refuses a second draw (already_drawn) and a draw before the play-in closes (play_in_open)', async () => {
    seedPlayIn();
    expect(codeOf(await drawEventBracket(EVENT))).toBe('play_in_open');
    data(await closePlayIn(EVENT));
    data(await drawEventBracket(EVENT));
    expect(codeOf(await drawEventBracket(EVENT))).toBe('already_drawn');
    expect(h.db.tables.bracket_matches).toHaveLength(7);
  });

  it('cryptoRng is uniform-ish in [0, 1)', () => {
    const xs = Array.from({ length: 2000 }, () => cryptoRng());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------
describe('createMatchCard', () => {
  it('a player in the match creates a match round + group of the two, snapshots handicaps, emails both a code', async () => {
    const bracket = seedDrawn();
    h.db.tables.players!.forEach((p, i) => void (p.handicap_index = i % 3));
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    asPlayer(m.a!);
    const r = data(await createMatchCard(EVENT, 'R1M1', TEE2, '2027-03-02'));
    expect(r).toMatchObject({ created: true, emailed: true, code: expect.stringMatching(/^[A-Z0-9]{6}$/) });
    const round = h.db.tables.rounds!.find((x) => x.kind === 'match')!;
    expect(round).toMatchObject({ event_id: EVENT, round_number: 2, tee_id: TEE2, play_date: '2027-03-02' });
    const group = h.db.tables.groups!.find((g) => g.round_id === round.id)!;
    expect(group).toMatchObject({ code: r.code, start_hole: 1 });
    expect(group.scorer_player_id ?? null).toBeNull();
    const gps = h.db.tables.group_players!.filter((x) => x.group_id === group.id);
    expect(gps.map((x) => x.player_id).sort()).toEqual([m.a, m.b].sort());
    const idx = (id: string) => P.indexOf(id) % 3;
    for (const gp of gps) expect(gp).toMatchObject({ index_snapshot: idx(gp.player_id as string), playing_handicap: idx(gp.player_id as string) });
    expect(bmOf('R1M1').group_id).toBe(group.id);
    expect(h.mailer.sent.map((x) => x.to).sort()).toEqual([`p${P.indexOf(m.a!)}@example.test`, `p${P.indexOf(m.b!)}@example.test`].sort());
    expect(h.mailer.sent[0]!.html).toContain(`https://tour.example.test/c/${r.code}`);
    expect(audits('card_created')).toHaveLength(1);

    // Idempotent: the other player (and the commissioner) get the same code, nothing new.
    asPlayer(m.b!);
    expect(data(await createMatchCard(EVENT, 'R1M1', null, null))).toEqual({ code: r.code, created: false, emailed: false });
    asPlayer(COMMISH, true);
    expect(data(await createMatchCard(EVENT, 'R1M1', null, null)).code).toBe(r.code);
    expect(h.db.tables.rounds!.filter((x) => x.kind === 'match')).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(2);
  });

  it('the next free round number follows existing rounds; null tee uses the play-in tee', async () => {
    seedDrawn();
    h.db.tables.rounds!.push({ id: 'r5', event_id: EVENT, round_number: 5, tee_id: TEE, kind: 'match' });
    await cardFor('R1M2');
    expect(h.db.tables.rounds!.find((x) => x.round_number === 6)).toMatchObject({ tee_id: TEE, kind: 'match' });
  });

  it('a player not in the match cannot start its card; nor anyone a match whose players are unknown', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const other = bracket.matches.find((x) => x.id === 'R1M2')!.a!;
    asPlayer(other);
    expect(codeOf(await createMatchCard(EVENT, 'R1M1', null, null))).toBe('not_participant');
    asPlayer(OUTSIDER);
    expect(codeOf(await createMatchCard(EVENT, 'R1M1', null, null))).toBe('not_participant');
    expect(h.db.writes).toHaveLength(0);
    asPlayer(m.a!);
    expect(codeOf(await createMatchCard(EVENT, 'R2M1', null, null))).toBe('not_participant');
    asPlayer(COMMISH, true);
    expect(codeOf(await createMatchCard(EVENT, 'R2M1', null, null))).toBe('not_playable');
    expect(codeOf(await createMatchCard(EVENT, 'R9M9', null, null))).toBe('unknown_match');
    expect(codeOf(await createMatchCard(EVENT, 'R1M1', null, '3/2/2027'))).toBe('invalid');
  });

  it('a failed email does not fail the card', async () => {
    seedDrawn();
    h.mailer.sendBatch = async () => {
      throw new Error('resend down');
    };
    asPlayer(COMMISH, true);
    expect(data(await createMatchCard(EVENT, 'R1M1', null, null))).toMatchObject({ created: true, emailed: false });
  });
});

// ---------------------------------------------------------------------------
describe('finalizeMatch', () => {
  it('the second signature locks the card and advances the winner into the next round (auto-finalize)', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.b!, m.a!, { up: 3 }); // b wins 3&2
    h.db.tables.groups!.find((g) => g.id === gid)!.scorer_player_id = m.a;
    data(await adminSignCard(gid, m.a!, 'scorer'));
    expect(matchOf('R1M1').winner).toBeNull();
    expect(data(await adminSignCard(gid, m.b!, 'attest'))).toEqual({ locked: true });
    expect(matchOf('R1M1').winner).toBe(m.b);
    expect(matchOf('R2M1').a).toBe(m.b);
    expect(bmOf('R1M1')).toMatchObject({ result: '3&2', forfeit: false });
    expect(audits('finalize')).toEqual([expect.objectContaining({ actor_player_id: COMMISH, entity: 'bracket_match', entity_id: 'bm-R1M1' })]);

    // Finalizing again is refused (recordWinner itself would overwrite).
    asPlayer(m.a!);
    expect(codeOf(await finalizeMatch(EVENT, 'R1M1'))).toBe('already_decided');
  });

  it('explicit finalize by a participant; refused while unsigned and for a non-participant', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M2')!;
    asPlayer(m.a!);
    expect(codeOf(await finalizeMatch(EVENT, 'R1M2'))).toBe('no_card');
    const gid = await cardFor('R1M2');
    scoreCard(gid, m.a!, m.b!, { up: 1 }); // a 1 UP after 18
    asPlayer(m.a!);
    expect(codeOf(await finalizeMatch(EVENT, 'R1M2'))).toBe('card_unsigned');
    lock(gid);
    asPlayer(OUTSIDER);
    expect(codeOf(await finalizeMatch(EVENT, 'R1M2'))).toBe('not_participant');
    asPlayer(m.b!);
    expect(data(await finalizeMatch(EVENT, 'R1M2'))).toEqual({ winnerId: m.a, result: '1 UP' });
    expect(matchOf('R2M1').b).toBe(m.a);
  });

  it('a card halved after 18 cannot be finalized', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 0 });
    lock(gid);
    expect(codeOf(await finalizeMatch(EVENT, 'R1M1'))).toBe('match_undecided');
    expect(matchOf('R1M1').winner).toBeNull();
  });

  it('an extra-hole win finalizes with "wins on 19th"', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.b!, m.a!, { up: 0, extra: [[3, 4]] });
    lock(gid);
    expect(data(await finalizeMatch(EVENT, 'R1M1'))).toEqual({ winnerId: m.b, result: 'wins on 19th' });
    expect(bmOf('R1M1').result).toBe('wins on 19th');
  });
});

// ---------------------------------------------------------------------------
describe('awardForfeit', () => {
  it('advances the winner with result Forfeit and an audit row; refuses a decided match or a stranger', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M2')!;
    expect(codeOf(await awardForfeit(EVENT, 'R1M2', OUTSIDER))).toBe('not_in_match');
    data(await awardForfeit(EVENT, 'R1M2', m.b!));
    expect(matchOf('R1M2').winner).toBe(m.b);
    expect(matchOf('R2M1').b).toBe(m.b);
    expect(bmOf('R1M2')).toMatchObject({ result: 'Forfeit', forfeit: true });
    expect(audits('forfeit')).toEqual([expect.objectContaining({ actor_player_id: COMMISH, entity: 'bracket_match', entity_id: 'bm-R1M2' })]);
    expect(codeOf(await awardForfeit(EVENT, 'R1M2', m.a!))).toBe('already_decided');
    expect(codeOf(await awardForfeit(EVENT, 'R2M1', m.b!))).toBe('not_playable');
  });
});

// ---------------------------------------------------------------------------
describe('setRoundDeadline', () => {
  it('stores a Central deadline on every match of the round, audited; clears with null', async () => {
    seedDrawn();
    data(await setRoundDeadline(EVENT, 1, '2027-03-14T18:00'));
    const r1 = h.db.tables.bracket_matches!.filter((m) => m.round === 1);
    expect(r1.map((m) => m.deadline)).toEqual(['2027-03-14T23:00:00.000Z', '2027-03-14T23:00:00.000Z']); // CDT = UTC-5
    expect(h.db.tables.bracket_matches!.find((m) => m.round === 2)!.deadline).toBeNull();
    expect(audits('deadline')).toHaveLength(1);
    data(await setRoundDeadline(EVENT, 1, null));
    expect(h.db.tables.bracket_matches!.filter((m) => m.round === 1).every((m) => m.deadline === null)).toBe(true);
    expect(codeOf(await setRoundDeadline(EVENT, 1, 'next tuesday'))).toBe('invalid');
    expect(codeOf(await setRoundDeadline(EVENT, 3, null))).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
describe('reopening a finalized match card', () => {
  async function finalized() {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 3 });
    lock(gid);
    data(await finalizeMatch(EVENT, 'R1M1'));
    return { bracket, m, gid };
  }

  it('clears the winner and result and takes the winner out of the next match', async () => {
    const { m, gid } = await finalized();
    expect(matchOf('R2M1').a).toBe(m.a);
    data(await reopenCard(gid, 'Wrong score on 7'));
    expect(matchOf('R1M1').winner).toBeNull();
    expect(matchOf('R2M1').a).toBeNull();
    expect(bmOf('R1M1').result).toBeNull();
    expect(audits('reopen_clear')).toHaveLength(1);
  });

  it('is refused once the next match has a card (next_match_started)', async () => {
    const { bracket, gid } = await finalized();
    const other = bracket.matches.find((x) => x.id === 'R1M2')!;
    data(await awardForfeit(EVENT, 'R1M2', other.a!));
    await cardFor('R2M1');
    expect(codeOf(await reopenCard(gid, 'Wrong score on 7'))).toBe('next_match_started');
    expect(h.db.tables.groups!.find((g) => g.id === gid)!.locked).toBe(true);
    expect(matchOf('R1M1').winner).not.toBeNull();
  });
});

describe('bracketState helpers', () => {
  it('resultLabel drops the side; clearWinner undoes recordWinner', () => {
    expect(resultLabel({ up: 1, thru: 19, finished: true, winner: 'A', label: 'A wins on 19th' })).toBe('wins on 19th');
    expect(resultLabel({ up: 3, thru: 16, finished: true, winner: 'B', label: '3&2' })).toBe('3&2');
    const b = drawBracket(['a', 'b', 'c', 'd'], () => 0.5);
    const won = { ...b, matches: b.matches.map((m) => (m.id === 'R1M2' ? { ...m, winner: m.b } : { ...m })) };
    won.matches.find((m) => m.id === 'R2M1')!.b = b.matches.find((m) => m.id === 'R1M2')!.b;
    expect(clearWinner(won, 'R1M2')).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
describe('getBracketView', () => {
  it('statuses, live label, deadlines and codes only for the match’s players', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    const code = h.db.tables.groups!.find((g) => g.id === gid)!.code;
    scoreCard(gid, m.b!, m.a!, { up: 2, holes: 2 }); // b 2 UP thru 2
    h.db.tables.bracket_matches!.filter((x) => x.round === 1).forEach((x) => void (x.deadline = '2020-01-01T00:00:00.000Z'));

    asPlayer(m.a!);
    const v = data(await getBracketView(EVENT));
    expect(v).toMatchObject({ drawn: true, closed: true, rounds: 2, me: m.a, isCommissioner: false });
    const r1m1 = v.matches.find((x) => x.key === 'R1M1')!;
    expect(r1m1).toMatchObject({ kind: 'live', status: `${NAME(P.indexOf(m.b!))} 2 UP thru 2`, mine: true, code, pastDeadline: true, playDate: '2027-03-02' });
    expect(v.matches.find((x) => x.key === 'R1M2')).toMatchObject({ kind: 'not_scheduled', status: 'Not scheduled', mine: false, code: null });
    expect(v.matches.find((x) => x.key === 'R2M1')).toMatchObject({ kind: 'waiting', status: 'TBD', pastDeadline: false });

    asPlayer(OUTSIDER);
    expect(data(await getBracketView(EVENT)).matches.every((x) => x.code === null)).toBe(true);
    asPlayer(COMMISH, true);
    expect(data(await getBracketView(EVENT)).matches.find((x) => x.key === 'R1M1')!.code).toBe(code);
  });

  it('before the draw: closed/drawn flags; a draft event is not_found', async () => {
    seedPlayIn();
    expect(data(await getBracketView(EVENT))).toMatchObject({ closed: false, drawn: false, matches: [] });
    h.db.tables.events![0]!.status = 'draft';
    expect(codeOf(await getBracketView(EVENT))).toBe('not_found');
  });

  it('missingMatchRows counts drawn matches with no bracket_matches row (Repair bracket)', async () => {
    seedDrawn();
    asPlayer(COMMISH, true);
    expect(data(await getBracketView(EVENT)).missingMatchRows).toBe(0);
    h.db.tables.bracket_matches = h.db.tables.bracket_matches!.filter((x) => x.round === 1);
    expect(data(await getBracketView(EVENT)).missingMatchRows).toBe(1);
  });
});

describe('describeMatch / roundName', () => {
  const both = { a: 'x', b: 'y', winner: null, isBye: false };
  const row = { result: null, forfeit: false };
  it('maps each state to its label', () => {
    expect(describeMatch({ ...both, b: null, winner: 'x', isBye: true }, row, null)).toEqual({ kind: 'bye', status: 'Bye' });
    expect(describeMatch({ ...both, b: null }, row, null)).toEqual({ kind: 'waiting', status: 'TBD' });
    expect(describeMatch(both, row, null)).toEqual({ kind: 'not_scheduled', status: 'Not scheduled' });
    expect(describeMatch(both, row, { playDate: '2027-03-02', scored: false, live: null })).toEqual({ kind: 'scheduled', status: 'Scheduled Mar 2' });
    expect(describeMatch(both, row, { playDate: null, scored: false, live: null }).status).toBe('Scheduled');
    const live = { state: { up: 2, thru: 12, finished: false, winner: null, label: 'A 2 UP thru 12' }, label: 'Xavier 2 UP thru 12' };
    expect(describeMatch(both, row, { playDate: null, scored: true, live })).toEqual({ kind: 'live', status: 'Xavier 2 UP thru 12' });
    expect(describeMatch({ ...both, winner: 'x' }, { result: '3&2', forfeit: false }, null)).toEqual({ kind: 'final', status: '3&2' });
    expect(describeMatch({ ...both, winner: 'x' }, { result: 'Forfeit', forfeit: true }, null)).toEqual({ kind: 'forfeit', status: 'Forfeit' });
  });
  it('names rounds from the final back', () => {
    expect([1, 2, 3, 4].map((r) => roundName(r, 4))).toEqual(['Round 1', 'Quarterfinals', 'Semifinals', 'Final']);
    expect(formatShortDate('2027-03-02')).toBe('Mar 2');
    expect(formatShortDate(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('review fixes: concurrency and partial failures', () => {
  /** Simulated concurrent writer: forfeit of R1M2 lands in the bracket state between our read and write. */
  function concurrentForfeit(bracket: Bracket) {
    const other = bracket.matches.find((x) => x.id === 'R1M2')!;
    h.onConflict = () => {
      const st = stateOf();
      st.bracket = { ...st.bracket!, matches: st.bracket!.matches.map((x) => ({ ...x })) };
      st.bracket.matches.find((x) => x.id === 'R1M2')!.winner = other.a;
      st.bracket.matches.find((x) => x.id === 'R2M1')!.b = other.a;
    };
    return other;
  }

  it('finalize retries a version conflict on a fresh read: both results survive', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 3 });
    lock(gid);
    const other = concurrentForfeit(bracket);
    h.conflicts = 1;
    expect(data(await finalizeMatch(EVENT, 'R1M1'))).toEqual({ winnerId: m.a, result: '3&2' });
    expect(matchOf('R1M1').winner).toBe(m.a);
    expect(matchOf('R1M2').winner).toBe(other.a);
    expect(matchOf('R2M1')).toMatchObject({ a: m.a, b: other.a });
  });

  it('auto-finalize when two cards lock at once still records the result', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 3 });
    h.db.tables.groups!.find((g) => g.id === gid)!.scorer_player_id = m.a;
    data(await adminSignCard(gid, m.a!, 'scorer'));
    concurrentForfeit(bracket);
    h.conflicts = 1;
    expect(data(await adminSignCard(gid, m.b!, 'attest'))).toEqual({ locked: true });
    expect(matchOf('R1M1').winner).toBe(m.a);
    expect(bmOf('R1M1').result).toBe('3&2');
  });

  it('exhausted retries leave no half-written result; finalizing again then works', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 3 });
    lock(gid);
    h.conflicts = 3;
    expect(codeOf(await finalizeMatch(EVENT, 'R1M1'))).toBe('conflict');
    expect(matchOf('R1M1').winner).toBeNull();
    expect(bmOf('R1M1').result).toBeNull();
    data(await finalizeMatch(EVENT, 'R1M1'));
    expect(bmOf('R1M1').result).toBe('3&2');
  });

  it('a winner with a missing result is repaired by finalizing again', async () => {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 3 });
    lock(gid);
    data(await finalizeMatch(EVENT, 'R1M1'));
    bmOf('R1M1').result = null; // e.g. a lost write
    expect(data(await finalizeMatch(EVENT, 'R1M1'))).toEqual({ winnerId: m.a, result: '3&2' });
    expect(bmOf('R1M1').result).toBe('3&2');
    expect(audits('finalize_repair')).toHaveLength(1);
    expect(codeOf(await finalizeMatch(EVENT, 'R1M1'))).toBe('already_decided');
  });

  async function finalizedR1M1() {
    const bracket = seedDrawn();
    const m = bracket.matches.find((x) => x.id === 'R1M1')!;
    const gid = await cardFor('R1M1');
    scoreCard(gid, m.a!, m.b!, { up: 3 });
    lock(gid);
    data(await finalizeMatch(EVENT, 'R1M1'));
    return { bracket, m, gid };
  }

  it('reopen clears the bracket before unlocking, retrying a conflict', async () => {
    const { bracket, gid } = await finalizedR1M1();
    concurrentForfeit(bracket);
    h.conflicts = 1;
    data(await reopenCard(gid, 'Wrong score on 7'));
    expect(matchOf('R1M1').winner).toBeNull();
    expect(matchOf('R2M1').a).toBeNull();
    expect(matchOf('R1M2').winner).not.toBeNull(); // the concurrent write survived
    expect(h.db.tables.groups!.find((g) => g.id === gid)!.locked).toBe(false);
  });

  it('a bracket failure during reopen leaves the card locked with its winner (nothing half done)', async () => {
    const { m, gid } = await finalizedR1M1();
    h.conflicts = 3;
    expect(codeOf(await reopenCard(gid, 'Wrong score on 7'))).toBe('conflict');
    expect(h.db.tables.groups!.find((g) => g.id === gid)!.locked).toBe(true);
    expect(matchOf('R1M1').winner).toBe(m.a);
    expect(bmOf('R1M1').result).toBe('3&2');
    data(await reopenCard(gid, 'Wrong score on 7')); // a retry works
    expect(matchOf('R1M1').winner).toBeNull();
  });

  it('adminEditScore is refused on a match card decided in the bracket; fine after a reopen', async () => {
    const { m, gid } = await finalizedR1M1();
    expect(codeOf(await adminEditScore(gid, m.a!, 7, 5))).toBe('match_decided');
    data(await reopenCard(gid, 'Wrong score on 7'));
    data(await adminEditScore(gid, m.a!, 7, 5));
  });

  it('a draw whose bracket_matches insert failed is repaired by drawing again', async () => {
    seedPlayIn();
    data(await closePlayIn(EVENT));
    h.failInsert.add('bracket_matches');
    await expect(drawEventBracket(EVENT)).rejects.toThrow(/insert into bracket_matches failed/);
    expect(stateOf().bracket).not.toBeNull();
    expect(h.db.tables.bracket_matches).toHaveLength(0);
    const again = data(await drawEventBracket(EVENT));
    expect(again).toEqual(stateOf().bracket);
    expect(h.db.tables.bracket_matches).toHaveLength(7);
    expect(audits('draw_repair')).toEqual([expect.objectContaining({ after: { action: 'draw_repair', added: 7 } })]);
    expect(codeOf(await drawEventBracket(EVENT))).toBe('already_drawn');
  });

  it('createMatchCard leaves no orphan round when the group cannot be created', async () => {
    seedDrawn();
    h.failInsert.add('group_players');
    asPlayer(COMMISH, true);
    await expect(createMatchCard(EVENT, 'R1M1', null, null)).rejects.toThrow(/group_players failed/);
    expect(h.db.tables.rounds!.filter((r) => r.kind === 'match')).toHaveLength(0);
    expect(h.db.tables.groups).toHaveLength(0);
    expect(bmOf('R1M1').group_id).toBeNull();
    data(await createMatchCard(EVENT, 'R1M1', null, null));
    expect(h.db.tables.rounds!.find((r) => r.kind === 'match')!.round_number).toBe(2);
  });
});
