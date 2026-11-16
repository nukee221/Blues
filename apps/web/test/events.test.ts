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
import { ACT } from '@/lib/actionCodes';
import { createFakeDb } from './fakeDb';
import type { EventInput } from '@/lib/eventSchema';

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
    await expect(setEventStatus(eventId, 'final')).resolves.toMatchObject({ ok: false, code: ACT.invalidTransition });
    expect(calls).toEqual([]);
  });
  it('rejects an unknown status', async () => {
    await expect(setEventStatus(eventId, 'bogus' as never)).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('returns not_found when the event does not exist', async () => {
    state.status = null;
    await expect(setEventStatus(eventId, 'published')).resolves.toMatchObject({ ok: false, code: ACT.notFound });
  });
  it('draft -> published updates status and writes an audit row', async () => {
    expect(await setEventStatus(eventId, 'published')).toEqual({ ok: true, data: null });
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
  it('returns not_found for an unknown id before touching rounds', async () => {
    state.status = null;
    await expect(saveEvent({ ...valid, id: eventId })).resolves.toMatchObject({ ok: false, code: ACT.notFound });
    expect(calls.some((c) => c.table === 'rounds')).toBe(false);
  });
  it('requires commissioner before anything', async () => {
    requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(saveEvent(valid)).rejects.toThrow(/forbidden/);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('validates input before any DB call', async () => {
    await expect(saveEvent({ ...valid, name: ' ' })).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    await expect(saveEvent({ ...valid, rounds: [] })).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    await expect(saveEvent({ ...valid, allowancePct: 150 })).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(adminClient.from).not.toHaveBeenCalled();
  });
  it('creates a draft match-play event whose round 1 is the stroke play-in', async () => {
    const out = await saveEvent(valid);
    expect(out).toEqual({ ok: true, data: { id: 'new-event' } });
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

describe('saveEvent locks once scoring has started (in-memory DB)', () => {
  const ROUND1 = '44444444-4444-4444-8444-444444444441';
  const ROUND2 = '44444444-4444-4444-8444-444444444442';
  const TEE2 = '55555555-5555-4555-8555-555555555555';
  let db: ReturnType<typeof createFakeDb>;
  const seed = (status: string, groups: Record<string, unknown>[] = []) => {
    db = createFakeDb({
      events: [
        {
          id: eventId,
          season_id: season,
          name: 'Opener',
          event_type: 'match_play',
          format: 'match_play',
          status,
          handicap_mode: 'net',
          allowance_pct: 100,
          handicap_basis: 'index',
          match_strokes: 'full',
          registration_deadline: '2027-04-01T12:00:00Z',
        },
      ],
      rounds: [
        { id: ROUND1, event_id: eventId, round_number: 1, tee_id: tee, play_date: '2027-04-10', kind: 'stroke' },
        { id: ROUND2, event_id: eventId, round_number: 2, tee_id: tee, play_date: '2027-04-17', kind: 'match' },
      ],
      groups,
      audit_log: [],
    });
    adminClient.from.mockImplementation((t: string) => db.from(t));
  };
  const form = (over: Partial<EventInput> = {}) => ({
    ...valid,
    id: eventId,
    rounds: [
      { roundNumber: 1, teeId: tee, playDate: '2027-04-10', kind: 'stroke' as const },
      { roundNumber: 2, teeId: tee, playDate: '2027-04-17', kind: 'match' as const },
    ],
    ...over,
  });
  const ev = () => db.tables.events![0]!;
  const openGroup = { id: 'g1', round_id: ROUND1, locked: false, signed_at: null };
  const signedGroup = { id: 'g1', round_id: ROUND1, locked: true, signed_at: '2027-04-10T20:00:00Z' };

  const lockedEdits: [string, Partial<EventInput>][] = [
    ['handicap mode', { handicapMode: 'gross' }],
    ['allowance', { allowancePct: 90 }],
    ['handicap basis', { handicapBasis: 'course' }],
    ['match strokes', { matchStrokes: 'offLow' }],
    ['format', { format: 'stroke' }],
    ['event type', { eventType: 'major' }],
    ['season', { seasonId: '66666666-6666-4666-8666-666666666666' }],
  ];
  for (const status of ['in_progress', 'final']) {
    for (const [label, over] of lockedEdits) {
      it(`${status}: refuses a ${label} change with event_locked and writes nothing`, async () => {
        seed(status, [openGroup]);
        const r = await saveEvent(form(over));
        expect(r).toMatchObject({ ok: false, code: ACT.eventLocked });
        expect((r as { error: string }).error).toContain(label);
        expect(db.writes).toEqual([]);
      });
    }
  }
  it('in_progress: refuses a round tee change, a new round, and a date change of a round with groups', async () => {
    for (const rounds of [
      [{ roundNumber: 1, teeId: TEE2, playDate: '2027-04-10', kind: 'stroke' as const }],
      [{ roundNumber: 3, teeId: tee, playDate: null, kind: 'match' as const }],
      [{ roundNumber: 1, teeId: tee, playDate: '2027-04-11', kind: 'stroke' as const }],
    ]) {
      seed('in_progress', [openGroup]);
      await expect(saveEvent(form({ rounds }))).resolves.toMatchObject({ ok: false, code: ACT.eventLocked });
      expect(db.writes).toEqual([]);
    }
  });
  it('a signed card locks even a registration_closed event', async () => {
    seed('registration_closed', [signedGroup]);
    await expect(saveEvent(form({ allowancePct: 90 }))).resolves.toMatchObject({ ok: false, code: ACT.eventLocked });
  });
  it('in_progress: name, deadline and the date of a round without groups still save, audited before/after', async () => {
    seed('in_progress', [openGroup]);
    const r = await saveEvent(
      form({
        name: 'Spring Opener',
        registrationDeadline: '2027-04-02T12:00:00Z',
        rounds: [
          { roundNumber: 1, teeId: tee, playDate: '2027-04-10', kind: 'stroke' },
          { roundNumber: 2, teeId: tee, playDate: '2027-04-18', kind: 'match' },
        ],
      }),
    );
    expect(r).toEqual({ ok: true, data: { id: eventId } });
    expect(ev()).toMatchObject({ name: 'Spring Opener', registration_deadline: '2027-04-02T12:00:00Z', status: 'in_progress' });
    expect(db.tables.rounds!.find((x) => x.id === ROUND2)).toMatchObject({ play_date: '2027-04-18' });
    expect(db.writes.some((w) => w.op === 'upsert')).toBe(false);
    expect(db.tables.audit_log).toHaveLength(1);
    expect(db.tables.audit_log![0]).toMatchObject({
      actor_player_id: 'commish-1',
      entity: 'event',
      entity_id: eventId,
      before: { name: 'Opener', registration_deadline: '2027-04-01T12:00:00Z', status: 'in_progress' },
      after: { name: 'Spring Opener', registration_deadline: '2027-04-02T12:00:00Z', locked: true, action: 'save_event' },
    });
    const after = db.tables.audit_log![0]!.after as { rounds: { round_number: number; play_date: string }[] };
    expect(after.rounds.find((x) => x.round_number === 2)?.play_date).toBe('2027-04-18');
  });
  it('a published event can still change settings, and the save is audited', async () => {
    seed('published');
    expect(await saveEvent(form({ allowancePct: 90, handicapMode: 'gross' }))).toMatchObject({ ok: true });
    expect(ev()).toMatchObject({ allowance_pct: 90, handicap_mode: 'gross' });
    expect(db.tables.audit_log![0]).toMatchObject({ before: { allowance_pct: 100 }, after: { allowance_pct: 90, locked: false } });
  });
  it('a draft event saves freely without an audit row', async () => {
    seed('draft');
    expect(await saveEvent(form({ allowancePct: 80 }))).toMatchObject({ ok: true });
    expect(ev()).toMatchObject({ allowance_pct: 80 });
    expect(db.tables.audit_log).toEqual([]);
  });
});
