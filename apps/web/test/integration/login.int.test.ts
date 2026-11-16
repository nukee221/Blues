import { afterAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// requestSignInLink against the local Auth server; the cookie client is a plain anon client here
// (the PKCE cookie round trip is covered by the real-login E2E).
const env = localSupabase();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.url, env.serviceKey, opts);
const h = vi.hoisted(() => ({ admin: null as unknown, anon: null as unknown }));
h.admin = admin;
h.anon = createClient(env.url, env.anonKey, opts);
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: '127.0.0.1:3000' }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.anon }));

import { requestSignInLink } from '@/actions/login';

const stamp = Date.now();
const stranger = `stranger-${stamp}@example.test`;
const rosterEmail = `roster-${stamp}@example.test`;
let playerId = '';

async function authUserId(email: string): Promise<string | null> {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

afterAll(async () => {
  for (const e of [stranger, rosterEmail]) {
    const id = await authUserId(e);
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (playerId) await admin.from('players').delete().eq('id', playerId);
});

describe('roster-gated sign-in against local Supabase', () => {
  it('a direct anon-key sign-up for a non-roster email is refused (sign-ups disabled)', async () => {
    const anon = createClient(env.url, env.anonKey, opts);
    const { error } = await anon.auth.signInWithOtp({ email: stranger, options: { shouldCreateUser: true } });
    expect(error).not.toBeNull();
    expect(await authUserId(stranger)).toBeNull();
  });
  it('requestSignInLink: non-roster -> neutral ok and no auth user; roster -> auth user created', async () => {
    await expect(requestSignInLink(stranger)).resolves.toEqual({ ok: true, data: null });
    expect(await authUserId(stranger)).toBeNull();

    const { data: p, error } = await admin.from('players').insert({ name: `Roster ${stamp}`, email: rosterEmail }).select('id').single();
    if (error) throw error;
    playerId = p!.id;
    await expect(requestSignInLink(rosterEmail)).resolves.toEqual({ ok: true, data: null });
    expect(await authUserId(rosterEmail)).not.toBeNull();
  });
});
