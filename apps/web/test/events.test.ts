import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminClient, calls, state } = vi.hoisted(() => ({
  adminClient: { from: vi.fn() },
  state: { status: 'draft' as string | null },
  calls: [] as { table: string; op: string; arg: unknown; opts?: unknown }[],
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }));
const requireCommissioner = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ requireCommissioner }));

import { saveEvent, setEventStatus } from '@/actions/events';

function fakeAdmin() {
  adminClient.from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {};
    b.insert = (arg: unknown) => (calls.push({ table, op: 'insert', arg }), b);
    b.update = (arg: unknown) => (calls.push({ table, op: 'update', arg }), b);
    b.upsert = (arg: unknown, opts: unknown) => (calls.push({ table, op: 'upsert', arg, opts }), b);
    b.select = () => b;
    b.eq = () => b;
    b.single = async () => ({ data: { id: 'new-event' }, error: null });
    b.maybeSingle = async () => ({
      data: state.status ? { id: 'e', status: state.status } : null,
      error: null,
    });
    b.then = (res: (v: unknown) => unknown) => res({ error: null });
    return b;
  });
}

const season = '11111111-1111-4111-8111-111111111111';
const tee = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const valid = {
  seasonId: season,
  name: 'Opener',
  eventType: 'match_play' as const,
  format: 'match_play' as const,
  handicapMode: 'net' as const,
  allowancePct: 100,
  handicapBasis: 'index' as const,
  matchStrokes: 'full' as const,
  registrationDeadline: '2027-04-01T12:00:00Z',
  rounds: [{ roundNumber: 1, teeId: tee, playDate: '2027-04-10', kind: 'match' as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.status = 'draft';
  requireCommissioner.mockResolvedValue({ player: { id: 'commish-1' } });
  fakeAdmin();
});

describe('setEventStatus', () => {
  it('requires commissioner before anything', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(setEventStatus(eventId, 'published')).rejects.toThrow(/forbidden/);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('rejects draft -> final without writing', async () => {
    await expect(setEventStatus(eventId, 'final')).rejects.toThrow(/draft.*final/);
    expect(calls).toEqual([]);
  });
  it('rejects an unknown status', async () => {
    await expect(setEventStatus(eventId, 'bogus' as never)).rejects.toThrow();
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('throws when the event does not exist', async () => {
    state.status = null;
    await expect(setEventStatus(eventId, 'published')).rejects.toThrow(/not found/i);
  });
  it('draft -> published updates status and writes an audit row', async () => {
    await setEventStatus(eventId, 'published');
    expect(calls).toContainEqual({ table: 'events', op: 'update', arg: { status: 'published' } });
    expect(calls).toContainEqual({
      table: 'audit_log',
      op: 'insert',
      arg: {
        actor_player_id: 'commish-1',
        entity: 'event',
        entity_id: eventId,
        before: { status: 'draft' },
        after: { status: 'published' },
      },
    });
  });
  it('final -> in_progress (reopen) is audited', async () => {
    state.status = 'final';
    await setEventStatus(eventId, 'in_progress');
    const audit = calls.find((c) => c.table === 'audit_log');
    expect(audit?.arg).toMatchObject({ before: { status: 'final' }, after: { status: 'in_progress' } });
  });
});

describe('saveEvent', () => {
  it('throws Event not found for an unknown id before touching rounds', async () => {
    state.status = null;
    await expect(saveEvent({ ...valid, id: eventId })).rejects.toThrow(/Event not found/);
    expect(calls.some((c) => c.table === 'rounds')).toBe(false);
  });
  it('requires commissioner before anything', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(saveEvent(valid)).rejects.toThrow(/forbidden/);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('validates input before any DB call', async () => {
    await expect(saveEvent({ ...valid, name: ' ' })).rejects.toThrow();
    await expect(saveEvent({ ...valid, rounds: [] })).rejects.toThrow();
    await expect(saveEvent({ ...valid, allowancePct: 150 })).rejects.toThrow();
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('creates a draft match-play event whose round 1 is the stroke play-in', async () => {
    const out = await saveEvent(valid);
    expect(out).toEqual({ id: 'new-event' });
    const ev = calls.find((c) => c.table === 'events' && c.op === 'insert');
    expect(ev?.arg).toMatchObject({ season_id: season, format: 'match_play', handicap_basis: 'index', match_strokes: 'full' });
    expect(ev?.arg).not.toHaveProperty('status');
    const rounds = calls.find((c) => c.table === 'rounds' && c.op === 'upsert');
    expect((rounds?.arg as { kind: string; round_number: number }[])[0]).toMatchObject({
      event_id: 'new-event',
      round_number: 1,
      kind: 'stroke',
    });
    expect(rounds?.opts).toEqual({ onConflict: 'event_id,round_number' });
  });
  it('keeps kind for stroke events and updates an existing event by id', async () => {
    await saveEvent({ ...valid, id: eventId, format: 'stroke', eventType: 'regular' });
    expect(calls.some((c) => c.table === 'events' && c.op === 'update')).toBe(true);
    const rounds = calls.find((c) => c.table === 'rounds' && c.op === 'upsert');
    expect((rounds?.arg as { kind: string }[])[0]?.kind).toBe('match');
  });
});
