import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminClient, calls, state } = vi.hoisted(() => ({
  adminClient: { from: vi.fn() },
  state: {
    otherCommissioners: 1,
    current: { is_commissioner: true } as Record<string, unknown> | null,
    rows: [] as Record<string, unknown>[],
  },
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
import { ACT } from '@/lib/actionCodes';

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
      res(selecting ? { count: state.otherCommissioners, error: null } : { data: state.rows, error: null });
    return b;
  });
}

const audits = () => calls.filter((c) => c.table === 'audit_log').map((c) => c.arg as Record<string, unknown>);
const valid = { name: 'Al', email: 'al@x.com', handicapIndex: 5.2, handicapSource: 'GHIN' as const, isCommissioner: false };
const id = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.otherCommissioners = 1;
  state.current = { id, name: 'Al', email: 'al@x.com', handicap_index: '7.0', handicap_source: 'GHIN', is_commissioner: true };
  state.rows = [];
  requireCommissioner.mockResolvedValue({ player: { id: 'commish-1' } });
  fakeAdmin();
});

describe('savePlayer', () => {
  it('requires commissioner before anything', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(savePlayer(valid)).rejects.toThrow(/forbidden/);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('validates input', async () => {
    await expect(savePlayer({ ...valid, handicapIndex: 60 })).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    await expect(savePlayer({ ...valid, email: 'nope' })).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    await expect(savePlayer({ ...valid, handicapSource: 'x' as never })).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('inserts a new player with lowercased email', async () => {
    const r = await savePlayer({ ...valid, email: 'Al@X.com' });
    expect(r).toEqual({ ok: true, data: { id: 'new-id' } });
    expect(calls[0]).toMatchObject({
      table: 'players',
      op: 'insert',
      arg: { name: 'Al', email: 'al@x.com', handicap_index: 5.2, handicap_source: 'GHIN', is_commissioner: false },
    });
  });
  it('updates an existing player', async () => {
    const r = await savePlayer({ ...valid, id });
    expect(r).toEqual({ ok: true, data: { id } });
    expect(calls.find((c) => c.op === 'update')).toBeTruthy();
  });
  it('audits an update with before/after index, source and commissioner flag', async () => {
    await savePlayer({ ...valid, id, handicapIndex: 5.24, isCommissioner: false });
    expect(audits()).toEqual([
      {
        actor_player_id: 'commish-1',
        entity: 'player',
        entity_id: id,
        before: { name: 'Al', email: 'al@x.com', handicap_index: 7, handicap_source: 'GHIN', is_commissioner: true },
        after: { name: 'Al', email: 'al@x.com', handicap_index: 5.2, handicap_source: 'GHIN', is_commissioner: false, action: 'save_player' },
      },
    ]);
  });
  it('audits a new player with before null', async () => {
    await savePlayer(valid);
    expect(audits()).toEqual([
      expect.objectContaining({ entity: 'player', entity_id: 'new-id', before: null, after: expect.objectContaining({ handicap_index: 5.2, action: 'create_player' }) }),
    ]);
  });
  it('returns not_found for an unknown player id without writing', async () => {
    state.current = null;
    await expect(savePlayer({ ...valid, id })).resolves.toMatchObject({ ok: false, code: ACT.notFound });
    expect(calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
  it('refuses to un-commissioner the last commissioner', async () => {
    state.otherCommissioners = 0;
    await expect(savePlayer({ ...valid, id, isCommissioner: false })).resolves.toMatchObject({
      ok: false,
      code: ACT.lastCommissioner,
    });
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });
  it('allows demotion when another commissioner exists', async () => {
    await savePlayer({ ...valid, id, isCommissioner: false });
    expect(calls.find((c) => c.op === 'update')).toBeTruthy();
  });
});

describe('applyHandicapUpdates', () => {
  it('requires commissioner and validates range', async () => {
    await expect(applyHandicapUpdates([{ playerId: id, index: 99 }])).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('updates each player and returns count', async () => {
    const r = await applyHandicapUpdates([
      { playerId: id, index: 4.4 },
      { playerId: '22222222-2222-4222-8222-222222222222', index: -1.2 },
    ]);
    expect(r).toEqual({ ok: true, data: { updated: 2 } });
    expect(calls.filter((c) => c.op === 'update').map((c) => c.arg)).toEqual([
      { handicap_index: 4.4 },
      { handicap_index: -1.2 },
    ]);
  });
  it('writes one audit row per player with the old and new index', async () => {
    state.rows = [{ id, name: 'Al', email: 'al@x.com', handicap_index: '7.0', handicap_source: 'GHIN', is_commissioner: false }];
    await applyHandicapUpdates([{ playerId: id, index: 4.44 }]);
    expect(audits()).toEqual([
      {
        actor_player_id: 'commish-1',
        entity: 'player',
        entity_id: id,
        before: { name: 'Al', email: 'al@x.com', handicap_index: 7, handicap_source: 'GHIN', is_commissioner: false },
        after: { name: 'Al', email: 'al@x.com', handicap_index: 4.4, handicap_source: 'GHIN', is_commissioner: false, action: 'handicap_paste' },
      },
    ]);
  });
});
