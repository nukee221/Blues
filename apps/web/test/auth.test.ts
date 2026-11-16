import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serverClient, adminClient } = vi.hoisted(() => ({
  serverClient: { auth: { getUser: vi.fn(), exchangeCodeForSession: vi.fn(), signOut: vi.fn() }, from: vi.fn() },
  adminClient: { from: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => serverClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }));

import { linkPlayerByEmail, requireCommissioner, requireUser } from '@/lib/auth';
import { GET } from '@/app/auth/callback/route';

/** Chainable fake of the PostgREST builder; resolves to `result` when awaited or via maybeSingle. */
function builder(result: { data: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'update']) b[m] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => ({ error: null, ...result }));
  b.then = (res: (v: unknown) => unknown) => res({ error: null, ...result });
  return b;
}

const player = (over = {}) => ({
  id: 'p1', user_id: 'u1', name: 'Pat', email: 'pat@x.com', is_commissioner: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireUser', () => {
  it('redirects to /login when no session', async () => {
    serverClient.auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('returns user id and player row', async () => {
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    serverClient.from.mockReturnValue(builder({ data: player() }));
    await expect(requireUser()).resolves.toMatchObject({ userId: 'u1', player: { id: 'p1' } });
  });

  it('redirects when the user is not linked to a player', async () => {
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    serverClient.from.mockReturnValue(builder({ data: null }));
    await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login?error=not-on-roster');
  });
});

describe('requireCommissioner', () => {
  it('redirects a non-commissioner to /forbidden', async () => {
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    serverClient.from.mockReturnValue(builder({ data: player({ is_commissioner: false }) }));
    await expect(requireCommissioner()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });

  it('allows a commissioner', async () => {
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    serverClient.from.mockReturnValue(builder({ data: player({ is_commissioner: true }) }));
    await expect(requireCommissioner()).resolves.toMatchObject({ userId: 'u1' });
  });
});

describe('linkPlayerByEmail', () => {
  it('links a matching email', async () => {
    const lookup = builder({ data: player({ user_id: null }) });
    const update = builder({ data: null });
    adminClient.from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);
    const r = await linkPlayerByEmail(adminClient as never, { id: 'u1', email: 'Pat@X.com' });
    expect(r).toEqual({ ok: true });
    expect(update.update).toHaveBeenCalledWith({ user_id: 'u1' });
  });

  it('rejects an unknown email', async () => {
    adminClient.from.mockReturnValueOnce(builder({ data: null }));
    const r = await linkPlayerByEmail(adminClient as never, { id: 'u1', email: 'nobody@x.com' });
    expect(r).toEqual({ ok: false, reason: 'not-on-roster' });
  });

  it('rejects a player already linked to another user', async () => {
    adminClient.from.mockReturnValueOnce(builder({ data: player({ user_id: 'other' }) }));
    const r = await linkPlayerByEmail(adminClient as never, { id: 'u1', email: 'pat@x.com' });
    expect(r).toEqual({ ok: false, reason: 'not-on-roster' });
  });
});

describe('auth callback route', () => {
  const req = (q: string) => new Request(`http://localhost:3000/auth/callback${q}`) as never;

  it('links and redirects home for a rostered email', async () => {
    serverClient.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'pat@x.com' } } });
    adminClient.from
      .mockReturnValueOnce(builder({ data: player({ user_id: null }) }))
      .mockReturnValueOnce(builder({ data: null }));
    const res = await GET(req('?code=abc'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
  });

  it('signs out and redirects with error for an unknown email', async () => {
    serverClient.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u2', email: 'nobody@x.com' } } });
    adminClient.from.mockReturnValueOnce(builder({ data: null }));
    const res = await GET(req('?code=abc'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/login');
    expect(loc.searchParams.get('error')).toBe('not-on-roster');
    expect(serverClient.auth.signOut).toHaveBeenCalled();
  });

  it('redirects to the host the browser used, not the host in request.url', async () => {
    serverClient.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    serverClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'pat@x.com' } } });
    adminClient.from
      .mockReturnValueOnce(builder({ data: player({ user_id: null }) }))
      .mockReturnValueOnce(builder({ data: null }));
    const r = new Request('http://localhost:3000/auth/callback?code=abc', { headers: { 'x-forwarded-host': '127.0.0.1:3000', 'x-forwarded-proto': 'https' } });
    const res = await GET(r as never);
    expect(res.headers.get('location')).toBe('https://127.0.0.1:3000/');
  });

  it('redirects with error when no code is present', async () => {
    const res = await GET(req(''));
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('invalid-link');
  });
});
