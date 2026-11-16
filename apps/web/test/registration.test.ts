import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; arg?: unknown };
const h = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; arg?: unknown }[],
  state: {
    event: null as { id: string; status: string; registration_deadline: string | null } | null,
    reg: null as { id: string; status: string } | null,
    insertError: null as { code: string; message: string } | null,
  },
  userClient: { from: vi.fn() },
  adminClient: { from: vi.fn() },
  requireUser: vi.fn(),
  requireCommissioner: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.userClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.adminClient }));
vi.mock('@/lib/auth', () => ({ requireUser: h.requireUser, requireCommissioner: h.requireCommissioner }));

import { register, withdraw, adminSetRegistration } from '@/actions/registration';
import { ACT } from '@/lib/actionCodes';

function fake(client: { from: ReturnType<typeof vi.fn> }) {
  client.from.mockImplementation((table: string) => {
    let op = 'select';
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.insert = (arg: unknown) => ((op = 'insert'), h.calls.push({ table, op, arg }), b);
    b.update = (arg: unknown) => ((op = 'update'), h.calls.push({ table, op, arg }), b);
    b.single = async () => ({ data: { id: 'new-reg' }, error: null });
    b.maybeSingle = async () => ({
      data: table === 'events' ? h.state.event : table === 'registrations' ? h.state.reg : null,
      error: null,
    });
    b.then = (res: (v: unknown) => unknown) =>
      res({ error: op === 'insert' && table === 'registrations' ? h.state.insertError : null });
    return b;
  });
}

const ev = '33333333-3333-4333-8333-333333333333';
const pl = '44444444-4444-4444-8444-444444444444';
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const writes = (table: string): Call[] => h.calls.filter((c) => c.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.state.event = { id: ev, status: 'published', registration_deadline: future };
  h.state.reg = null;
  h.state.insertError = null;
  h.requireUser.mockResolvedValue({ userId: 'u', player: { id: pl } });
  h.requireCommissioner.mockResolvedValue({ userId: 'u', player: { id: 'commish' } });
  fake(h.userClient);
  fake(h.adminClient);
});

describe('register', () => {
  it('inserts a registered row on a published event before the deadline, via the player client', async () => {
    await register(ev);
    expect(writes('registrations')).toEqual([
      { table: 'registrations', op: 'insert', arg: { event_id: ev, player_id: pl, status: 'registered' } },
    ]);
    expect(h.adminClient.from).not.toHaveBeenCalled();
  });
  it('is idempotent when already registered (no write)', async () => {
    h.state.reg = { id: 'r', status: 'registered' };
    await expect(register(ev)).resolves.toEqual({ ok: true, data: null });
    expect(writes('registrations')).toEqual([]);
  });
  it('re-registers a withdrawn row by updating status only', async () => {
    h.state.reg = { id: 'r', status: 'withdrawn' };
    await register(ev);
    expect(writes('registrations')).toEqual([{ table: 'registrations', op: 'update', arg: { status: 'registered' } }]);
  });
  it('treats a unique-violation race as success', async () => {
    h.state.insertError = { code: '23505', message: 'dup' };
    await expect(register(ev)).resolves.toEqual({ ok: true, data: null });
  });
  it('returns registration_closed after the deadline', async () => {
    h.state.event!.registration_deadline = past;
    await expect(register(ev)).resolves.toMatchObject({ ok: false, code: ACT.registrationClosed });
    expect(writes('registrations')).toEqual([]);
  });
  it('returns registration_closed with no deadline or a non-published status', async () => {
    h.state.event!.registration_deadline = null;
    await expect(register(ev)).resolves.toMatchObject({ ok: false, code: ACT.registrationClosed });
    h.state.event = { id: ev, status: 'in_progress', registration_deadline: future };
    await expect(register(ev)).resolves.toMatchObject({ ok: false, code: ACT.registrationClosed });
  });
  it('returns not_found for a draft or a missing event', async () => {
    h.state.event = { id: ev, status: 'draft', registration_deadline: future };
    await expect(register(ev)).resolves.toMatchObject({ ok: false, code: ACT.notFound });
    h.state.event = null;
    await expect(register(ev)).resolves.toMatchObject({ ok: false, code: ACT.notFound });
    expect(writes('registrations')).toEqual([]);
  });
  it('rejects a non-uuid id before any call', async () => {
    await expect(register('nope')).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(h.userClient.from).not.toHaveBeenCalled();
  });
});

describe('withdraw', () => {
  it('updates an existing registration to withdrawn', async () => {
    h.state.reg = { id: 'r', status: 'registered' };
    await withdraw(ev);
    expect(writes('registrations')).toEqual([{ table: 'registrations', op: 'update', arg: { status: 'withdrawn' } }]);
  });
  it('is a no-op when not registered or already withdrawn', async () => {
    await withdraw(ev);
    h.state.reg = { id: 'r', status: 'withdrawn' };
    await withdraw(ev);
    expect(writes('registrations')).toEqual([]);
  });
  it('is rejected after the deadline', async () => {
    h.state.event!.registration_deadline = past;
    h.state.reg = { id: 'r', status: 'registered' };
    await expect(withdraw(ev)).resolves.toMatchObject({ ok: false, code: ACT.registrationClosed });
  });
});

describe('adminSetRegistration', () => {
  it('requires commissioner before anything', async () => {
    h.requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    await expect(adminSetRegistration(ev, pl, 'registered')).rejects.toThrow(/forbidden/);
    expect(h.adminClient.from).not.toHaveBeenCalled();
  });
  it('adds a player after close (inserts) and audits', async () => {
    h.state.event = { id: ev, status: 'published', registration_deadline: past };
    await adminSetRegistration(ev, pl, 'registered');
    expect(writes('registrations')).toEqual([
      { table: 'registrations', op: 'insert', arg: { event_id: ev, player_id: pl, status: 'registered' } },
    ]);
    expect(writes('audit_log')[0]?.arg).toMatchObject({
      actor_player_id: 'commish',
      entity: 'registration',
      entity_id: 'new-reg',
      before: null,
      after: { event_id: ev, player_id: pl, status: 'registered' },
    });
  });
  it('removes an existing registration by updating status and audits before/after', async () => {
    h.state.reg = { id: 'r', status: 'registered' };
    await adminSetRegistration(ev, pl, 'withdrawn');
    expect(writes('registrations')).toEqual([{ table: 'registrations', op: 'update', arg: { status: 'withdrawn' } }]);
    expect(writes('audit_log')[0]?.arg).toMatchObject({
      entity: 'registration',
      entity_id: 'r',
      before: { status: 'registered' },
      after: { status: 'withdrawn' },
    });
  });
  it('rejects a final event and a missing event', async () => {
    h.state.event = { id: ev, status: 'final', registration_deadline: past };
    await expect(adminSetRegistration(ev, pl, 'registered')).resolves.toMatchObject({ ok: false, code: ACT.eventFinal });
    h.state.event = null;
    await expect(adminSetRegistration(ev, pl, 'registered')).resolves.toMatchObject({ ok: false, code: ACT.notFound });
  });
  it('rejects bad status input before any call', async () => {
    await expect(adminSetRegistration(ev, pl, 'x' as never)).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(h.adminClient.from).not.toHaveBeenCalled();
  });
});
