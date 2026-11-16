import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminClient, serverClient, calls } = vi.hoisted(() => ({
  adminClient: { from: vi.fn() },
  serverClient: { from: vi.fn() },
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
    b.then = (res: (v: unknown) => unknown) => res({ error: null });
    return b;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  requireCommissioner.mockResolvedValue({});
  fakeAdmin();
});

describe('saveCourse validation', () => {
  const rejects = async (input: unknown, msg: RegExp) => {
    await expect(saveCourse(input as never)).rejects.toThrow(msg);
    expect(requireCommissioner).not.toHaveBeenCalled();
    expect(adminClient.from).not.toHaveBeenCalled();
  };

  it('rejects stroke indexes that are not exactly 1-18', async () => {
    const h = holes();
    h[1]!.strokeIndex = 18; // duplicate 18, missing 4
    await rejects(course(tee({ holes: h })), /Stroke indexes/);
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

describe('saveCourse writes', () => {
  it('accepts a valid course, requires commissioner, writes via admin client', async () => {
    await expect(saveCourse(course())).resolves.toEqual({ id: 'courses-id' });
    expect(requireCommissioner).toHaveBeenCalledOnce();
    const up = calls.find((c) => c.op === 'upsert')!;
    expect(up.table).toBe('holes');
    expect(up.opts).toEqual({ onConflict: 'tee_id,number' });
    expect((up.arg as unknown[]).length).toBe(18);
    expect((up.arg as { stroke_index: number }[])[0]).toMatchObject({ tee_id: 'tees-id', number: 1, stroke_index: 18 });
  });
  it('does not write when not a commissioner', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(saveCourse(course())).rejects.toThrow('NEXT_REDIRECT:/forbidden');
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('updates an existing course and tee instead of inserting', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await saveCourse({ id, name: 'X', tees: [{ ...tee(), id }] });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'update').map((c) => c.table)).toEqual(['courses', 'tees']);
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
