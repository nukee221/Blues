import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawBracket, recordWinner, type Bracket } from '@hgt/scoring';
import { createFakeDb } from './fakeDb';

/**
 * Points actions against the in-memory fake (no RLS: getStandings' own final-only filter is
 * what is exercised here; the RLS read is covered by test/integration/points.int.test.ts).
 */
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>,
  requireUser: vi.fn(),
  requireCommissioner: vi.fn(),
  getTeeInfo: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => h.db.from(t) }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: (t: string) => h.db.from(t) }) }));
vi.mock('@/lib/auth', () => ({ requireUser: h.requireUser, requireCommissioner: h.requireCommissioner }));
vi.mock('@/lib/courses', () => ({ getTeeInfo: h.getTeeInfo }));

import { clearOverride, finalizeEvent, getStandings, overridePoints, saveEventTypePoints } from '@/actions/points';
import { setEventStatus } from '@/actions/events';
import { FEDEX_500 } from '@hgt/scoring';
import type { ActionResult } from '@/lib/actionResult';

function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r.data;
}
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);

const SEASON = '55555555-5555-4555-8555-555555555555';
const EVENT = '11111111-1111-4111-8111-111111111111';
const EVENT2 = '11111111-1111-4111-8111-111111111112';
const TEE = '33333333-3333-4333-8333-333333333333';
const BRACKET = '66666666-6666-4666-8666-666666666666';
const P = Array.from({ length: 12 }, (_, i) => `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`);
const COMMISH = '44444444-4444-4444-8444-0000000000cc';
const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const tee = { rating: 72, slope: 113, par: 72, holes: holes18 };
const NAME = (i: number) => `Player ${String.fromCharCode(65 + i)}`;
const HCP = (i: number) => (i === 0 ? -1.2 : i * 1.5); // P0 is a plus handicap

function baseTables(): Record<string, Row[]> {
  return {
    seasons: [{ id: SEASON, year: 2027 }],
    points_tables: [
      { id: 'pt-mp', season_id: SEASON, event_type: 'match_play', winner_points: 500, table_values: [...FEDEX_500] },
      { id: 'pt-reg', season_id: SEASON, event_type: 'regular', winner_points: 500, table_values: [...FEDEX_500] },
    ],
    events: [
      { id: EVENT, season_id: SEASON, name: 'Match Play Opener', event_type: 'match_play', format: 'match_play', status: 'in_progress', handicap_mode: 'gross', allowance_pct: 100, handicap_basis: 'index', match_strokes: 'full', created_at: '2027-01-01T00:00:00Z' },
    ],
    rounds: [{ id: 'r1', event_id: EVENT, round_number: 1, tee_id: TEE, play_date: '2027-03-01', kind: 'stroke' }],
    players: [...P.map((id, i) => ({ id, name: NAME(i) })), { id: COMMISH, name: 'Zed Commish' }],
    public_players: [...P.map((id, i) => ({ id, name: NAME(i), handicap_index: HCP(i), home_club: i === 1 ? 'Cherokee Ridge' : null, photo_version: i === 1 ? 5 : 0 })), { id: COMMISH, name: 'Zed Commish' }],
    registrations: P.map((id, i) => ({ id: `reg-${i}`, event_id: EVENT, player_id: id, status: 'registered' })),
    groups: [],
    group_players: [],
    scores: [],
    brackets: [],
    bracket_matches: [],
    points_awards: [],
    audit_log: [],
  };
}

function makeDb(t: Record<string, Row[]>) {
  h.db = createFakeDb(t, { brackets: ['event_id'] });
}

/** Every match decided, the `a` side always winning (byes come pre-decided). */
function playOut(bracket: Bracket): Bracket {
  let b = bracket;
  for (let round = 1; round <= b.rounds; round++) {
    for (const m of b.matches.filter((x) => x.round === round && !x.isBye)) b = recordWinner(b, m.id, m.a!);
  }
  return b;
}

/** A drawn (and by default fully played) bracket of `advanced` for EVENT. */
function seedBracket(advanced: string[], opts: { finished?: boolean; drawn?: boolean } = {}): Bracket {
  const t = baseTables();
  const drawn = drawBracket(advanced, () => 0.5);
  const bracket = opts.finished === false ? drawn : playOut(drawn);
  t.brackets!.push({ id: BRACKET, event_id: EVENT, size: bracket.size, rounds: bracket.rounds, version: 3, state: { advanced, bracket: opts.drawn === false ? null : bracket } });
  makeDb(t);
  return bracket;
}

const awardsOf = (eventId = EVENT) => h.db.tables.points_awards!.filter((a) => a.event_id === eventId);
const pointsOf = (playerId: string, eventId = EVENT) => awardsOf(eventId).find((a) => a.player_id === playerId)?.points;
const finalMatch = (b: Bracket) => b.matches.find((m) => m.round === b.rounds)!;
function losersOf(b: Bracket, round: number): string[] {
  return b.matches.filter((m) => m.round === round && !m.isBye).map((m) => (m.winner === m.a ? m.b! : m.a!));
}
const eventStatus = (id = EVENT) => h.db.tables.events!.find((e) => e.id === id)!.status;

beforeEach(() => {
  vi.clearAllMocks();
  h.requireCommissioner.mockResolvedValue({ userId: 'u-c', player: { id: COMMISH, is_commissioner: true } });
  h.requireUser.mockResolvedValue({ userId: 'u-p', player: { id: P[0], is_commissioner: false } });
  h.getTeeInfo.mockResolvedValue(tee);
});

// ---------------------------------------------------------------------------
// finalizeEvent: match play
// ---------------------------------------------------------------------------
describe('finalizeEvent (match play)', () => {
  it('8-player bracket: 500, 300, T3 162.5 each, T5 96.25 each; event final; audited', async () => {
    const b = seedBracket(P.slice(0, 8));
    const out = data(await finalizeEvent(EVENT));
    const fin = finalMatch(b);
    const champion = fin.winner!;
    const runnerUp = fin.winner === fin.a ? fin.b! : fin.a!;
    expect(pointsOf(champion)).toBe(500);
    expect(pointsOf(runnerUp)).toBe(300);
    const semis = losersOf(b, 2);
    const quarters = losersOf(b, 1);
    expect(semis).toHaveLength(2);
    expect(quarters).toHaveLength(4);
    for (const p of semis) expect(pointsOf(p)).toBe(162.5); // (190 + 135) / 2
    for (const p of quarters) expect(pointsOf(p)).toBe(96.25); // (110 + 100 + 90 + 85) / 4
    expect(awardsOf()).toHaveLength(8);
    expect(awardsOf().every((a) => a.override === false)).toBe(true);
    expect(out.awards).toHaveLength(8);
    expect(out.awards.find((a) => a.playerId === champion)).toMatchObject({ points: 500 });

    expect(eventStatus()).toBe('final');
    const logs = h.db.tables.audit_log!;
    expect(logs).toContainEqual(expect.objectContaining({ actor_player_id: COMMISH, entity: 'event', entity_id: EVENT, before: { status: 'in_progress' }, after: { status: 'final' } }));
    const summary = logs.find((a) => a.entity === 'points_awards');
    expect(summary).toMatchObject({ actor_player_id: COMMISH, entity_id: EVENT, after: { action: 'finalize', table_source: 'season' } });
    expect((summary!.after as { awards: unknown[] }).awards).toHaveLength(8);
  });

  it('play-in non-advancers get no award row', async () => {
    seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    for (const p of P.slice(8)) expect(pointsOf(p)).toBeUndefined();
  });

  it('6 advancers (2 byes): 500, 300, T3 162.5 x2, T5 105 x2; bye winners get no R1 placing', async () => {
    const b = seedBracket(P.slice(0, 6));
    expect(b.matches.filter((m) => m.isBye)).toHaveLength(2);
    data(await finalizeEvent(EVENT));
    const pts = awardsOf().map((a) => a.points as number).sort((x, y) => y - x);
    expect(pts).toEqual([500, 300, 162.5, 162.5, 105, 105]); // T5: (110 + 100) / 2
  });

  it('uses the season table as stored (commissioner-edited values)', async () => {
    seedBracket(P.slice(0, 8));
    data(await saveEventTypePoints(SEASON, 'match_play', 1000, [1000, 600, 400, 300, 200, 100]));
    data(await finalizeEvent(EVENT));
    const pts = awardsOf().map((a) => a.points as number).sort((x, y) => y - x);
    // T3 (400 + 300) / 2; T5 (200 + 100 + 0 + 0) / 4 (missing entries count 0)
    expect(pts).toEqual([1000, 600, 350, 350, 75, 75, 75, 75]);
  });

  it('falls back to pointsTable(500) only when the season has no row for the event type', async () => {
    seedBracket(P.slice(0, 8));
    h.db.tables.points_tables = h.db.tables.points_tables!.filter((t) => t.event_type !== 'match_play');
    data(await finalizeEvent(EVENT));
    expect(awardsOf().map((a) => a.points as number).sort((x, y) => y - x)).toEqual([500, 300, 162.5, 162.5, 96.25, 96.25, 96.25, 96.25]);
    expect(h.db.tables.audit_log!.find((a) => a.entity === 'points_awards')!.after).toMatchObject({ table_source: 'default' });
  });

  it("'bracket_incomplete' when the bracket is missing, not drawn, or the final is undecided; nothing written", async () => {
    makeDb(baseTables());
    expect(codeOf(await finalizeEvent(EVENT))).toBe('bracket_incomplete');
    seedBracket(P.slice(0, 8), { drawn: false });
    expect(codeOf(await finalizeEvent(EVENT))).toBe('bracket_incomplete');
    seedBracket(P.slice(0, 8), { finished: false });
    expect(codeOf(await finalizeEvent(EVENT))).toBe('bracket_incomplete');
    expect(awardsOf()).toHaveLength(0);
    expect(eventStatus()).toBe('in_progress');
    expect(h.db.tables.audit_log).toHaveLength(0);
  });

  it("'wrong_status' unless in progress or final; 'not_found'; 'invalid' id", async () => {
    seedBracket(P.slice(0, 8));
    h.db.tables.events![0]!.status = 'registration_closed';
    expect(codeOf(await finalizeEvent(EVENT))).toBe('wrong_status');
    expect(codeOf(await finalizeEvent(EVENT2))).toBe('not_found');
    expect(codeOf(await finalizeEvent('nope'))).toBe('invalid');
  });

  it('requires a commissioner before anything', async () => {
    seedBracket(P.slice(0, 8));
    h.requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(finalizeEvent(EVENT)).rejects.toThrow(/forbidden/);
    await expect(overridePoints(EVENT, P[0]!, 1)).rejects.toThrow(/forbidden/);
    await expect(clearOverride(EVENT, P[0]!)).rejects.toThrow(/forbidden/);
    await expect(saveEventTypePoints(SEASON, 'regular', 500, [500])).rejects.toThrow(/forbidden/);
    expect(h.db.writes).toHaveLength(0);
  });

  it('already final: recompute is idempotent (same rows, no second status change)', async () => {
    seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    const before = awardsOf().map((a) => [a.player_id, a.points]).sort();
    data(await finalizeEvent(EVENT));
    expect(awardsOf().map((a) => [a.player_id, a.points]).sort()).toEqual(before);
    expect(h.db.tables.audit_log!.filter((a) => a.entity === 'event')).toHaveLength(1);
    expect(h.db.tables.audit_log!.filter((a) => a.entity === 'points_awards')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------
describe('overridePoints / clearOverride', () => {
  it('override survives re-finalize, including after an audited reopen', async () => {
    const b = seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    const champion = finalMatch(b).winner!;
    data(await overridePoints(EVENT, champion, 450.5));
    expect(awardsOf().find((a) => a.player_id === champion)).toMatchObject({ points: 450.5, override: true });
    const audit = h.db.tables.audit_log!.find((a) => a.entity === 'points_award');
    expect(audit).toMatchObject({
      actor_player_id: COMMISH,
      entity_id: EVENT,
      before: { player_id: champion, points: 500, override: false },
      after: { player_id: champion, points: 450.5, override: true },
    });

    data(await finalizeEvent(EVENT)); // already final: recompute
    expect(pointsOf(champion)).toBe(450.5);
    expect(awardsOf()).toHaveLength(8);

    data(await setEventStatus(EVENT, 'in_progress')); // audited reopen
    data(await finalizeEvent(EVENT));
    expect(eventStatus()).toBe('final');
    expect(awardsOf().find((a) => a.player_id === champion)).toMatchObject({ points: 450.5, override: true });
    expect(awardsOf()).toHaveLength(8);
  });

  it('an override can give a player with no award row points (e.g. a non-advancer)', async () => {
    seedBracket(P.slice(0, 8));
    data(await overridePoints(EVENT, P[10]!, 25));
    expect(awardsOf()).toEqual([expect.objectContaining({ player_id: P[10], points: 25, override: true })]);
    expect(h.db.tables.audit_log!.find((a) => a.entity === 'points_award')!.before).toBeNull();
    data(await finalizeEvent(EVENT));
    expect(pointsOf(P[10]!)).toBe(25);
    expect(awardsOf()).toHaveLength(9);
  });

  it("validates points: >= 0, at most 2 decimals; 'not_found' for unknown event or player", async () => {
    seedBracket(P.slice(0, 8));
    expect(codeOf(await overridePoints(EVENT, P[0]!, -1))).toBe('invalid');
    expect(codeOf(await overridePoints(EVENT, P[0]!, 1.005))).toBe('invalid');
    expect(codeOf(await overridePoints(EVENT, P[0]!, Number.NaN))).toBe('invalid');
    expect(codeOf(await overridePoints(EVENT, 'x', 1))).toBe('invalid');
    expect(codeOf(await overridePoints(EVENT2, P[0]!, 1))).toBe('not_found');
    expect(codeOf(await overridePoints(EVENT, '44444444-4444-4444-8444-0000000000ee', 1))).toBe('not_found');
    expect(awardsOf()).toHaveLength(0);
    expect(data(await overridePoints(EVENT, P[0]!, 0))).toBeNull();
    expect(pointsOf(P[0]!)).toBe(0);
  });

  it('clearOverride on a final event removes the override and recomputes that row now (audited)', async () => {
    const b = seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    const champion = finalMatch(b).winner!;
    data(await overridePoints(EVENT, champion, 1));
    data(await clearOverride(EVENT, champion));
    expect(awardsOf().find((a) => a.player_id === champion)).toMatchObject({ points: 500, override: false });
    expect(awardsOf()).toHaveLength(8);
    const audit = h.db.tables.audit_log!.filter((a) => a.entity === 'points_award').at(-1)!;
    expect(audit).toMatchObject({ before: { player_id: champion, points: 1, override: true }, after: { player_id: champion, points: 500, override: false, action: 'clear_override' } });
  });

  it('clearOverride before finalize removes the row (recomputed on the next finalize)', async () => {
    seedBracket(P.slice(0, 8));
    data(await overridePoints(EVENT, P[10]!, 25));
    data(await clearOverride(EVENT, P[10]!));
    expect(awardsOf()).toHaveLength(0);
    expect(h.db.tables.audit_log!.filter((a) => a.entity === 'points_award').at(-1)!.after).toMatchObject({ player_id: P[10], points: null, action: 'clear_override' });
  });

  it('clearOverride on a final event for a player with no computed placing leaves no row', async () => {
    seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    data(await overridePoints(EVENT, P[10]!, 25));
    data(await clearOverride(EVENT, P[10]!));
    expect(pointsOf(P[10]!)).toBeUndefined();
    expect(awardsOf()).toHaveLength(8);
  });

  it("clearOverride: 'not_found' when there is no override", async () => {
    seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    expect(codeOf(await clearOverride(EVENT, P[0]!))).toBe('not_found');
    expect(pointsOf(P[0]!)).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// finalizeEvent: stroke play
// ---------------------------------------------------------------------------
describe('finalizeEvent (stroke play)', () => {
  /** Two stroke rounds; player i in group (i % 2) of each round; totals[r][i] gross (null = no row). */
  function seedStroke(totals: (number | null)[][], opts: { unlocked?: string; withdrawn?: string[]; incomplete?: string[] } = {}) {
    const t = baseTables();
    t.events = [{ id: EVENT, season_id: SEASON, name: 'Spring Stroke', event_type: 'regular', format: 'stroke', status: 'in_progress', handicap_mode: 'gross', created_at: '2027-01-01T00:00:00Z' }];
    t.rounds = totals.map((_, r) => ({ id: `r${r + 1}`, event_id: EVENT, round_number: r + 1, tee_id: TEE, play_date: `2027-04-0${r + 1}`, kind: 'stroke' }));
    totals.forEach((row, r) => {
      for (const g of [0, 1]) t.groups!.push({ id: `g${r}-${g}`, round_id: `r${r + 1}`, locked: opts.unlocked !== `g${r}-${g}`, signed_at: null });
      row.forEach((total, i) => {
        if (total === null) return;
        const gid = `g${r}-${i % 2}`;
        t.group_players!.push({ id: `gp${r}-${i}`, group_id: gid, player_id: P[i], playing_handicap: 0, withdrawn: opts.withdrawn?.includes(`${r}:${i}`) ?? false });
        const holes = opts.incomplete?.includes(`${r}:${i}`) ? 17 : 18;
        for (let hole = 1; hole <= holes; hole++) {
          t.scores!.push({ id: `s${r}-${i}-${hole}`, group_id: gid, player_id: P[i], hole, gross: hole <= total - 72 ? 5 : 4 });
        }
      });
    });
    makeDb(t);
  }

  it('placings by the total across all stroke rounds; ties split; WD and incomplete cards get no row', async () => {
    // P0: 72+73=145 (1st) · P1: 74+72=146 and P2: 73+73=146 (T2) · P3: 78+72=150 (4th)
    // P4 WD in round 2 · P5 17 holes in round 1 · P6 missing from round 2
    seedStroke(
      [
        [72, 74, 73, 78, 72, 72, 72],
        [73, 72, 73, 72, 72, 72, null],
      ],
      { withdrawn: ['1:4'], incomplete: ['0:5'] },
    );
    data(await finalizeEvent(EVENT));
    expect(pointsOf(P[0]!)).toBe(500);
    expect(pointsOf(P[1]!)).toBe(245); // (300 + 190) / 2
    expect(pointsOf(P[2]!)).toBe(245);
    expect(pointsOf(P[3]!)).toBe(135);
    for (const i of [4, 5, 6]) expect(pointsOf(P[i]!)).toBeUndefined();
    expect(eventStatus()).toBe('final');
  });

  it('net mode ranks by net totals', async () => {
    seedStroke([[72, 74]]);
    h.db.tables.events![0]!.handicap_mode = 'net';
    h.db.tables.group_players!.find((g) => g.player_id === P[1])!.playing_handicap = 4; // 74 - 4 = 70
    data(await finalizeEvent(EVENT));
    expect(pointsOf(P[1]!)).toBe(500);
    expect(pointsOf(P[0]!)).toBe(300);
  });

  it("'cards_unsigned' when a card with a player still in is not locked; a card of only WD players does not block", async () => {
    seedStroke([[72, 74, 73]], { unlocked: 'g0-1' });
    expect(codeOf(await finalizeEvent(EVENT))).toBe('cards_unsigned');
    expect(awardsOf()).toHaveLength(0);
    expect(eventStatus()).toBe('in_progress');

    seedStroke([[72, 74, 73]], { unlocked: 'g0-1', withdrawn: ['0:1'] });
    data(await finalizeEvent(EVENT));
    expect(awardsOf()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// saveEventTypePoints
// ---------------------------------------------------------------------------
describe('saveEventTypePoints', () => {
  it('updates the season row for the type, audited with before/after', async () => {
    makeDb(baseTables());
    data(await saveEventTypePoints(SEASON, 'match_play', 600, [600, 400, 400, 100, 0]));
    expect(h.db.tables.points_tables!.find((t) => t.event_type === 'match_play')).toMatchObject({ winner_points: 600, table_values: [600, 400, 400, 100, 0] });
    expect(h.db.tables.audit_log!.find((a) => a.entity === 'points_table')).toMatchObject({
      actor_player_id: COMMISH,
      entity_id: 'pt-mp',
      before: { event_type: 'match_play', winner_points: 500, table_values: [...FEDEX_500] },
      after: { season_id: SEASON, event_type: 'match_play', winner_points: 600, table_values: [600, 400, 400, 100, 0] },
    });
  });

  it('inserts a row for a type the season lacks', async () => {
    makeDb(baseTables());
    data(await saveEventTypePoints(SEASON, 'major', 750, [750, 450]));
    expect(h.db.tables.points_tables!.filter((t) => t.event_type === 'major')).toEqual([expect.objectContaining({ season_id: SEASON, winner_points: 750, table_values: [750, 450] })]);
    expect(h.db.tables.audit_log!.find((a) => a.entity === 'points_table')!.before).toBeNull();
  });

  it("rejects bad tables with 'invalid' and writes nothing", async () => {
    makeDb(baseTables());
    const bad: [number, number[]][] = [
      [500, []], // no values
      [500, [500, 300, 310]], // increasing
      [500, [450, 300]], // first != winner
      [500, [500, -1]], // negative
      [0, [0]], // winner not positive
      [500, [500, Number.POSITIVE_INFINITY]],
    ];
    for (const [w, v] of bad) expect(codeOf(await saveEventTypePoints(SEASON, 'regular', w, v))).toBe('invalid');
    expect(codeOf(await saveEventTypePoints(SEASON, 'bogus' as never, 500, [500]))).toBe('invalid');
    expect(codeOf(await saveEventTypePoints('55555555-5555-4555-8555-000000000000', 'regular', 500, [500]))).toBe('not_found');
    expect(h.db.writes).toHaveLength(0);
  });

  it('does not change already-final events until they are recalculated', async () => {
    seedBracket(P.slice(0, 8));
    data(await finalizeEvent(EVENT));
    data(await saveEventTypePoints(SEASON, 'match_play', 1000, [1000, 600]));
    expect(Math.max(...awardsOf().map((a) => a.points as number))).toBe(500);
    data(await finalizeEvent(EVENT)); // "Recalculate"
    expect(Math.max(...awardsOf().map((a) => a.points as number))).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// getStandings
// ---------------------------------------------------------------------------
describe('getStandings', () => {
  function seedSeason() {
    const t = baseTables();
    t.events = [
      // Listed out of date order on purpose: the event dated first comes first in byEvent.
      { id: EVENT2, season_id: SEASON, name: 'Second Event', event_type: 'regular', format: 'stroke', status: 'final', created_at: '2027-01-01T00:00:00Z' },
      { id: EVENT, season_id: SEASON, name: 'Opener', event_type: 'match_play', format: 'match_play', status: 'final', created_at: '2027-02-01T00:00:00Z' },
      { id: 'e-draft', season_id: SEASON, name: 'Draft', event_type: 'regular', format: 'stroke', status: 'draft', created_at: '2027-01-01T00:00:00Z' },
      { id: 'e-open', season_id: SEASON, name: 'Reopened', event_type: 'regular', format: 'stroke', status: 'in_progress', created_at: '2027-01-01T00:00:00Z' },
      { id: 'e-other', season_id: 'other-season', name: 'Other', event_type: 'regular', format: 'stroke', status: 'final', created_at: '2026-01-01T00:00:00Z' },
    ];
    t.rounds = [
      { id: 'r-e1', event_id: EVENT, round_number: 1, play_date: '2027-03-01' },
      { id: 'r-e2', event_id: EVENT2, round_number: 1, play_date: '2027-04-10' },
      { id: 'r-e2b', event_id: EVENT2, round_number: 2, play_date: '2027-04-11' },
    ];
    // Opener: P0..P9 get 100..10; Second: P9 gets 200, P1 gets 5, P10 gets 10.
    const awards: Row[] = [];
    P.slice(0, 10).forEach((p, i) => awards.push({ id: `a1-${i}`, event_id: EVENT, player_id: p, points: 100 - i * 10, override: false }));
    awards.push({ id: 'a2-9', event_id: EVENT2, player_id: P[9], points: 200, override: false });
    awards.push({ id: 'a2-1', event_id: EVENT2, player_id: P[1], points: 5, override: false });
    awards.push({ id: 'a2-10', event_id: EVENT2, player_id: P[10], points: 10, override: false });
    awards.push({ id: 'a-draft', event_id: 'e-draft', player_id: P[11], points: 999, override: true });
    awards.push({ id: 'a-open', event_id: 'e-open', player_id: P[11], points: 999, override: false });
    awards.push({ id: 'a-other', event_id: 'e-other', player_id: P[11], points: 999, override: false });
    t.points_awards = awards;
    makeDb(t);
  }

  it('sums across final events, ranks with shared ties, marks top 8, breaks down by event in date order', async () => {
    seedSeason();
    const rows = data(await getStandings(SEASON));
    // Totals: P9 210, P0 100, P1 95, P2 80, P3 70, P4 60, P5 50, P6 40, P7 30, P8 20, P10 10
    expect(rows.map((r) => [r.name, r.total, r.position])).toEqual([
      [NAME(9), 210, 1],
      [NAME(0), 100, 2],
      [NAME(1), 95, 3],
      [NAME(2), 80, 4],
      [NAME(3), 70, 5],
      [NAME(4), 60, 6],
      [NAME(5), 50, 7],
      [NAME(6), 40, 8],
      [NAME(7), 30, 9],
      [NAME(8), 20, 10],
      [NAME(10), 10, 11],
    ]);
    expect(rows.filter((r) => r.qualified).map((r) => r.playerId)).toEqual([P[9], P[0], P[1], P[2], P[3], P[4], P[5], P[6]]);
    const p1 = rows.find((r) => r.playerId === P[1])!;
    expect(p1.eventsPlayed).toBe(2);
    expect(p1.byEvent).toEqual([
      { eventId: EVENT, eventName: 'Opener', eventNumber: 1, points: 90 },
      { eventId: EVENT2, eventName: 'Second Event', eventNumber: 2, points: 5 },
    ]);
    // Event numbers are season-wide: P10 played only the second event.
    expect(rows.find((r) => r.playerId === P[10])!.byEvent.map((b) => b.eventNumber)).toEqual([2]);
    expect(rows.find((r) => r.playerId === P[1])!.handicapIndex).toBe(HCP(1));
    expect(rows.find((r) => r.playerId === P[1])!).toMatchObject({ homeClub: 'Cherokee Ridge', photoVersion: 5 });
    expect(rows.find((r) => r.playerId === P[2])!).toMatchObject({ homeClub: null, photoVersion: 0 });
    expect(rows.some((r) => r.playerId === P[11])).toBe(false); // draft, reopened, other season
  });

  it('ties share a position and are flagged; ties at 8th all qualify', async () => {
    seedSeason();
    h.db.tables.points_awards!.find((a) => a.id === 'a1-7')!.points = 40; // P7 ties P6 at 40
    const rows = data(await getStandings(SEASON));
    const p6 = rows.find((r) => r.playerId === P[6])!;
    const p7 = rows.find((r) => r.playerId === P[7])!;
    expect([p6.position, p6.tied, p6.qualified]).toEqual([8, true, true]);
    expect([p7.position, p7.tied, p7.qualified]).toEqual([8, true, true]);
    expect(rows.find((r) => r.playerId === P[8])!.position).toBe(10);
  });

  it('points to 2 decimals', async () => {
    seedSeason();
    h.db.tables.points_awards!.find((a) => a.id === 'a1-0')!.points = '96.25';
    h.db.tables.points_awards!.find((a) => a.id === 'a1-1')!.points = 162.5;
    const rows = data(await getStandings(SEASON));
    expect(rows.find((r) => r.playerId === P[0])!.total).toBe(96.25);
    expect(rows.find((r) => r.playerId === P[1])!.total).toBe(167.5);
  });

  it("requires a signed-in player; 'invalid' season id", async () => {
    seedSeason();
    expect(codeOf(await getStandings('x'))).toBe('invalid');
    h.requireUser.mockRejectedValue(new Error('NEXT_REDIRECT:/login'));
    await expect(getStandings(SEASON)).rejects.toThrow(/login/);
  });
});

describe('setEventStatus to final', () => {
  it("is refused with 'use_finalize' (points must be awarded through finalizeEvent)", async () => {
    seedBracket(P.slice(0, 8));
    expect(codeOf(await setEventStatus(EVENT, 'final'))).toBe('use_finalize');
    expect(eventStatus()).toBe('in_progress');
    expect(h.db.writes).toHaveLength(0);
  });
});
