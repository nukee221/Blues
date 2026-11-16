import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  player: null as { id: string; user_id: string | null } | null,
  createUser: vi.fn(),
  signInWithOtp: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'golf.example.test', 'x-forwarded-proto': 'https' }) }));
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
import { ACT } from '@/lib/actionCodes';

beforeEach(() => {
  vi.clearAllMocks();
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
    h.signInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });
    await expect(requestSignInLink('a@example.test')).resolves.toMatchObject({ ok: false, code: ACT.emailFailed });
    await expect(requestSignInLink('nope')).resolves.toMatchObject({ ok: false, code: ACT.invalid });
  });
});
