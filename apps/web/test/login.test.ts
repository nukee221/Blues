import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  player: null as { id: string; user_id: string | null } | null,
  createUser: vi.fn(),
  signInWithOtp: vi.fn(),
  headers: {} as Record<string, string>,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers(h.headers) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: h.player, error: null });
      return b;
    },
    auth: { admin: { createUser: h.createUser } },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { signInWithOtp: h.signInWithOtp } }) }));

import { requestSignInLink } from '@/actions/login';
import { resetLoginLimit } from '@/lib/loginLimit';
import { ACT } from '@/lib/actionCodes';

beforeEach(() => {
  vi.clearAllMocks();
  resetLoginLimit();
  h.headers = { host: 'golf.example.test', 'x-forwarded-proto': 'https' };
  h.player = null;
  h.createUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
  h.signInWithOtp.mockResolvedValue({ error: null });
});

describe('requestSignInLink', () => {
  it('an email not on the roster gets the neutral ok, and no user or email is created', async () => {
    await expect(requestSignInLink('stranger@example.test')).resolves.toEqual({ ok: true, data: null });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });
  it('a roster email with no account: creates the auth user server-side, then sends with shouldCreateUser false', async () => {
    h.player = { id: 'p', user_id: null };
    await expect(requestSignInLink(' Player12@Example.test ')).resolves.toEqual({ ok: true, data: null });
    expect(h.createUser).toHaveBeenCalledWith({ email: 'player12@example.test', email_confirm: true });
    expect(h.signInWithOtp).toHaveBeenCalledWith({
      email: 'player12@example.test',
      options: { emailRedirectTo: 'https://golf.example.test/auth/callback', shouldCreateUser: false },
    });
  });
  it('an existing auth user is fine (already registered), and a linked player skips creation', async () => {
    h.player = { id: 'p', user_id: null };
    h.createUser.mockResolvedValue({ data: null, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } });
    await expect(requestSignInLink('a@example.test')).resolves.toMatchObject({ ok: true });
    h.player = { id: 'p', user_id: 'u1' };
    h.createUser.mockClear();
    await expect(requestSignInLink('a@example.test')).resolves.toMatchObject({ ok: true });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.signInWithOtp).toHaveBeenCalledTimes(2);
  });
  it('a send failure is a returned email_failed; an invalid email is invalid', async () => {
    h.player = { id: 'p', user_id: 'u1' };
    h.signInWithOtp.mockResolvedValue({ error: { message: 'smtp down' } });
    await expect(requestSignInLink('a@example.test')).resolves.toMatchObject({ ok: false, code: ACT.emailFailed });
    await expect(requestSignInLink('nope')).resolves.toMatchObject({ ok: false, code: ACT.invalid });
  });
  it.each([
    [{ status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' }],
    [{ status: 429, message: 'For security purposes, you can only request this after 49 seconds.' }],
    [{ code: 'over_email_send_rate_limit', message: 'x' }],
  ])('a Supabase rate-limit / resend-cooldown error returns the same neutral ok as an unknown email', async (err) => {
    h.player = { id: 'p', user_id: 'u1' };
    h.signInWithOtp.mockResolvedValue({ error: err });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(requestSignInLink('a@example.test')).resolves.toEqual({ ok: true, data: null });
    expect(warn).toHaveBeenCalled(); // logged server-side
  });
  it('per-IP limit: the 6th request in 10 minutes gets the neutral ok and sends nothing', async () => {
    h.player = { id: 'p', user_id: 'u1' };
    h.headers = { ...h.headers, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) await requestSignInLink('a@example.test');
    expect(h.signInWithOtp).toHaveBeenCalledTimes(5);
    await expect(requestSignInLink('a@example.test')).resolves.toEqual({ ok: true, data: null });
    expect(h.signInWithOtp).toHaveBeenCalledTimes(5);
    h.headers = { ...h.headers, 'x-forwarded-for': '203.0.113.10' }; // another IP is unaffected
    await requestSignInLink('a@example.test');
    expect(h.signInWithOtp).toHaveBeenCalledTimes(6);
  });
  it('the redirect origin comes from APP_URL, not the forged Host header', async () => {
    h.player = { id: 'p', user_id: 'u1' };
    vi.stubEnv('APP_URL', 'https://golf.real.test/');
    h.headers = { host: 'evil.example', 'x-forwarded-host': 'evil.example' };
    await requestSignInLink('a@example.test');
    expect(h.signInWithOtp.mock.calls[0]![0].options.emailRedirectTo).toBe('https://golf.real.test/auth/callback');
    vi.unstubAllEnvs();
  });
});
