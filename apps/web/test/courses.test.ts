import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminClient, serverClient, calls, state } = vi.hoisted(() => ({
  adminClient: { from: vi.fn() },
  serverClient: { from: vi.fn() },
  state: { foreignTee: false },
  calls: [] as { table: string; op: string; arg: unknown; opts?: unknown }[],
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => serverClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }));
const requireCommissioner = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ requireCommissioner }));

import { saveCourse } from '@/actions/courses';
import { getTeeInfo } from '@/lib/courses';
import { ACT } from '@/lib/actionCodes';
import { createFakeDb } from './fakeDb';

const pars = [4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4]; // 72
const sis = [18, 4, 10, 8, 16, 12, 6, 14, 2, 3, 15, 11, 7, 1, 17, 5, 13, 9];
const holes = () => pars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i]! }));
const tee = (over = {}) => ({ name: 'Blue', rating: 71.8, slope: 140, par: 72, holes: holes(), ...over });
const course = (t = tee()) => ({ name: 'Cherokee Ridge', tees: [t] });

function fakeAdmin() {
  adminClient.from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {};
    b.insert = (arg: unknown) => (calls.push({ table, op: 'insert', arg }), b);
    b.update = (arg: unknown) => (calls.push({ table, op: 'update', arg }), b);
    b.upsert = (arg: unknown, opts: unknown) => (calls.push({ table, op: 'upsert', arg, opts }), b);
    b.select = () => b;
    b.eq = () => b;
    b.single = async () => ({ data: { id: `${table}-id` }, error: null });
    b.maybeSingle = async () => ({ data: state.foreignTee ? null : { id: `${table}-id` }, error: null });
    b.then = (res: (v: unknown) => unknown) => res({ error: null });
    return b;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.foreignTee = false;
  requireCommissioner.mockResolvedValue({ player: { id: 'commish-1' } });
  fakeAdmin();
});

describe('saveCourse validation', () => {
  const rejects = async (input: unknown, msg: RegExp) => {
    const r = await saveCourse(input as never);
    expect(r).toMatchObject({ ok: false, code: ACT.invalid });
    expect((r as { error: string }).error).toMatch(msg);
    expect(requireCommissioner).toHaveBeenCalled(); // auth first
    expect(adminClient.from).not.toHaveBeenCalled();
  };

  it('rejects stroke indexes that are not exactly 1-18', async () => {
    const h = holes();
    h[1]!.strokeIndex = 18; // duplicate 18, missing 4
    await rejects(course(tee({ holes: h })), /Stroke indexes/);
  });
  it('rejects duplicate or missing hole numbers', async () => {
    const h = holes();
    h[17]!.number = 1; // two hole 1s, no hole 18
    await rejects(course(tee({ holes: h })), /numbered 1-18/);
  });
  it('rejects slope outside 55-155', async () => {
    await rejects(course(tee({ slope: 156 })), /Slope/);
    await rejects(course(tee({ slope: 54 })), /Slope/);
  });
  it('rejects par sum that differs from tee par', async () => {
    await rejects(course(tee({ par: 71 })), /sum to 72/);
  });
  it('rejects hole par outside 3-6, rating <= 0, and wrong hole count', async () => {
    const h = holes();
    h[0]!.par = 7;
    await rejects(course(tee({ holes: h, par: 75 })), /Hole par/);
    await rejects(course(tee({ rating: 0 })), /Rating/);
    await rejects(course(tee({ holes: holes().slice(0, 17) })), /18 holes/);
  });
});

describe('saveCourse writes (in-memory DB)', () => {
  const COURSE = '11111111-1111-4111-8111-111111111111';
  const TEE = '22222222-2222-4222-8222-222222222222';
  const ROUND = '33333333-3333-4333-8333-333333333333';
  const holeRows = () => holes().map((h) => ({ id: `h${h.number}`, tee_id: TEE, number: h.number, par: h.par, stroke_index: h.strokeIndex }));
  let db: ReturnType<typeof createFakeDb>;
  const seed = (signed: boolean | null) => {
    db = createFakeDb({
      courses: [{ id: COURSE, name: 'Cherokee Ridge' }],
      tees: [{ id: TEE, course_id: COURSE, name: 'Blue', rating: '71.8', slope: 140, par: 72 }],
      holes: holeRows(),
      rounds: signed === null ? [] : [{ id: ROUND, event_id: 'e', tee_id: TEE, round_number: 1 }],
      groups: signed === null ? [] : [{ id: 'g', round_id: ROUND, locked: signed, signed_at: signed ? '2027-04-10T20:00:00Z' : null }],
      audit_log: [],
    });
    adminClient.from.mockImplementation((t: string) => db.from(t));
  };
  const existing = (over = {}) => ({ id: COURSE, name: 'Cherokee Ridge', tees: [{ ...tee(), id: TEE, ...over }] });
  const holesOf = () => db.tables.holes!.filter((h) => h.tee_id === TEE);

  it('creates a course, tee and 18 holes, audited', async () => {
    seed(null);
    const r = await saveCourse(course());
    expect(r).toMatchObject({ ok: true });
    const { id, teeIds } = (r as { data: { id: string; teeIds: string[] } }).data;
    expect(db.tables.holes!.filter((h) => h.tee_id === teeIds[0])).toHaveLength(18);
    expect(db.tables.audit_log!.map((a) => [a.entity, a.entity_id, a.before])).toEqual([
      ['course', id, null],
      ['tee', teeIds[0], null],
    ]);
    expect(db.tables.audit_log![0]).toMatchObject({ actor_player_id: 'commish-1' });
  });
  it('does not write when not a commissioner', async () => {
    seed(null);
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(saveCourse(course())).rejects.toThrow('NEXT_REDIRECT:/forbidden');
    expect(db.writes).toEqual([]);
  });
  it('updates an unlocked tee in place (holes upserted) and audits before/after', async () => {
    seed(false); // used by a round whose card is not signed
    const h = holes();
    h[0]!.par = 5;
    h[1]!.par = 3;
    expect(await saveCourse(existing({ slope: 141, holes: h }))).toMatchObject({ ok: true });
    expect(db.tables.tees![0]).toMatchObject({ slope: 141 });
    expect(holesOf()).toHaveLength(18);
    expect(holesOf().find((x) => x.number === 1)).toMatchObject({ par: 5 });
    const a = db.tables.audit_log!.find((x) => x.entity === 'tee')!;
    expect(a).toMatchObject({ entity_id: TEE, before: { slope: 140 }, after: { slope: 141 } });
    expect(db.writes.filter((w) => w.op === 'insert' && w.table !== 'audit_log')).toEqual([]);
  });
  it('refuses rating/slope/par/hole changes to a tee with a signed card, writing nothing', async () => {
    const h = holes();
    h[0]!.strokeIndex = 4;
    h[1]!.strokeIndex = 18;
    for (const over of [{ slope: 141 }, { rating: 72.0 }, { holes: h }]) {
      seed(true);
      const r = await saveCourse(existing(over));
      expect(r).toMatchObject({ ok: false, code: ACT.teeLocked });
      expect((r as { error: string }).error).toMatch(/new tee/);
      expect(db.writes).toEqual([]);
    }
  });
  it('still allows renaming a tee with a signed card (audited) and an unchanged save', async () => {
    seed(true);
    expect(await saveCourse(existing({ rating: 71.8 }))).toMatchObject({ ok: true });
    expect(db.tables.audit_log).toEqual([]); // nothing changed, nothing audited
    expect(await saveCourse({ ...existing({ name: 'Blue (old)' }), name: 'Cherokee Ridge GC' })).toMatchObject({ ok: true });
    expect(db.tables.tees![0]).toMatchObject({ name: 'Blue (old)', slope: 140 });
    expect(db.tables.audit_log!.map((a) => a.entity).sort()).toEqual(['course', 'tee']);
  });
  it('adding a new tee to a course whose other tee is locked is allowed', async () => {
    seed(true);
    const c = existing();
    expect(await saveCourse({ ...c, tees: [...c.tees, tee({ name: 'Blue 2027', slope: 141 })] })).toMatchObject({ ok: true });
    expect(db.tables.tees).toHaveLength(2);
  });
  it('returns tee_not_in_course and writes nothing when the tee does not belong to the course', async () => {
    seed(null);
    db.tables.tees![0]!.course_id = 'other-course';
    await expect(saveCourse(existing())).resolves.toMatchObject({ ok: false, code: ACT.teeNotInCourse });
    expect(db.writes).toEqual([]);
  });
});

describe('getTeeInfo', () => {
  it('maps and sorts holes by number', async () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.single = async () => ({
      data: { rating: '71.8', slope: 140, par: 72, holes: [
        { number: 2, par: 4, stroke_index: 4 }, { number: 1, par: 4, stroke_index: 18 } ] },
      error: null,
    });
    serverClient.from.mockReturnValue(b);
    await expect(getTeeInfo('t')).resolves.toEqual({
      rating: 71.8, slope: 140, par: 72,
      holes: [{ number: 1, par: 4, strokeIndex: 18 }, { number: 2, par: 4, strokeIndex: 4 }],
    });
  });
});
