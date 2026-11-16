import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminClient, calls, state } = vi.hoisted(() => ({
  adminClient: { from: vi.fn() },
  state: { otherCommissioners: 1, current: { is_commissioner: true } as { is_commissioner: boolean } | null },
  calls: [] as { table: string; op: string; arg: unknown }[],
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }));
const requireCommissioner = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ requireCommissioner }));

import { applyHandicapUpdates, savePlayer } from '@/actions/players';

function fakeAdmin() {
  adminClient.from.mockImplementation((table: string) => {
    let selecting = false;
    const b: Record<string, unknown> = {};
    b.insert = (arg: unknown) => (calls.push({ table, op: 'insert', arg }), b);
    b.update = (arg: unknown) => (calls.push({ table, op: 'update', arg }), b);
    b.select = (_c?: string, o?: { count?: string }) => ((selecting = !!o), b);
    b.eq = () => b;
    b.neq = () => b;
    b.in = () => b;
    b.single = async () => ({ data: { id: 'new-id' }, error: null });
    b.maybeSingle = async () => ({ data: state.current, error: null });
    b.then = (res: (v: unknown) => unknown) =>
      res(selecting ? { count: state.otherCommissioners, error: null } : { error: null });
    return b;
  });
}

const valid = { name: 'Al', email: 'al@x.com', handicapIndex: 5.2, handicapSource: 'GHIN' as const, isCommissioner: false };
const id = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.otherCommissioners = 1;
  state.current = { is_commissioner: true };
  requireCommissioner.mockResolvedValue({});
  fakeAdmin();
});

describe('savePlayer', () => {
  it('requires commissioner before anything', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(savePlayer(valid)).rejects.toThrow(/forbidden/);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('validates input', async () => {
    await expect(savePlayer({ ...valid, handicapIndex: 60 })).rejects.toThrow();
    await expect(savePlayer({ ...valid, email: 'nope' })).rejects.toThrow();
    await expect(savePlayer({ ...valid, handicapSource: 'x' as never })).rejects.toThrow();
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('inserts a new player with lowercased email', async () => {
    const r = await savePlayer({ ...valid, email: 'Al@X.com' });
    expect(r).toEqual({ id: 'new-id' });
    expect(calls[0]).toMatchObject({
      table: 'players',
      op: 'insert',
      arg: { name: 'Al', email: 'al@x.com', handicap_index: 5.2, handicap_source: 'GHIN', is_commissioner: false },
    });
  });
  it('updates an existing player', async () => {
    const r = await savePlayer({ ...valid, id });
    expect(r).toEqual({ id });
    expect(calls.find((c) => c.op === 'update')).toBeTruthy();
  });
  it('refuses to un-commissioner the last commissioner', async () => {
    state.otherCommissioners = 0;
    await expect(savePlayer({ ...valid, id, isCommissioner: false })).rejects.toThrow(/last commissioner/i);
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });
  it('allows demotion when another commissioner exists', async () => {
    await savePlayer({ ...valid, id, isCommissioner: false });
    expect(calls.find((c) => c.op === 'update')).toBeTruthy();
  });
});

describe('applyHandicapUpdates', () => {
  it('requires commissioner and validates range', async () => {
    await expect(applyHandicapUpdates([{ playerId: id, index: 99 }])).rejects.toThrow();
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('updates each player and returns count', async () => {
    const r = await applyHandicapUpdates([
      { playerId: id, index: 4.4 },
      { playerId: '22222222-2222-4222-8222-222222222222', index: -1.2 },
    ]);
    expect(r).toEqual({ updated: 2 });
    expect(calls.filter((c) => c.op === 'update').map((c) => c.arg)).toEqual([
      { handicap_index: 4.4 },
      { handicap_index: -1.2 },
    ]);
  });
});
