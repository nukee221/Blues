import { createServerClient } from '@supabase/ssr';
import type { Browser, BrowserContext } from '@playwright/test';
import { devices } from '@playwright/test';
import { adminClient, supabaseEnv } from './env';

const { defaultBrowserType: _ignored, ...phone } = devices['iPhone 14'];
export const PHONE = { ...phone, deviceScaleFactor: 2 } as const;

type Cookie = { name: string; value: string };

/** Uncaught page errors and console errors from every page of every context; the spec asserts there are none. */
export const browserErrors: string[] = [];
function watch(context: BrowserContext): BrowserContext {
  context.on('page', (page) => {
    page.on('pageerror', (e) => browserErrors.push(`pageerror ${page.url()}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') browserErrors.push(`console ${page.url()}: ${m.text()}`);
    });
  });
  return context;
}

/**
 * A signed-in session for `email`, as the cookies @supabase/ssr keeps. The auth user is created with
 * the admin API and signed in from a generated magic link's token (verifyOtp). The app's own
 * /auth/callback cannot take that link: it only handles the PKCE `?code=` the real sign-in form
 * produces, while an admin-generated link redirects with tokens in the URL fragment. So the cookies are
 * written here, and the account is linked to the seeded player by email exactly as the callback does
 * (players.user_id, service role, only when still unlinked).
 */
export async function sessionCookies(email: string): Promise<Cookie[]> {
  const admin = adminClient();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) throw created.error;
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data.properties) throw link.error ?? new Error('no link');
  const userId = link.data.user.id;

  const jar = new Map<string, string>();
  const sb = createServerClient(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await sb.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: link.data.properties.verification_type as 'magiclink',
  });
  if (error) throw error;
  await sb.auth.getSession();
  if (jar.size === 0) throw new Error('no session cookies were produced');

  const { error: linkError } = await admin.from('players').update({ user_id: userId }).eq('email', email).is('user_id', null);
  if (linkError) throw linkError;
  const { data: row } = await admin.from('players').select('user_id').eq('email', email).single();
  if (row?.user_id !== userId) throw new Error(`${email} is not linked to its auth user`);
  return [...jar].map(([name, value]) => ({ name, value }));
}

/** A fresh phone-sized browser context signed in as `email`. */
export async function phoneAs(browser: Browser, baseURL: string, email: string): Promise<BrowserContext> {
  const context = watch(await browser.newContext({ ...PHONE, baseURL }));
  await context.addCookies((await sessionCookies(email)).map((c) => ({ ...c, url: baseURL })));
  return context;
}

/** A fresh phone-sized context with no login (a scorer holding only a group code). */
export function anonymousPhone(browser: Browser, baseURL: string): Promise<BrowserContext> {
  return browser.newContext({ ...PHONE, baseURL }).then(watch);
}
