import { defineConfig, devices } from '@playwright/test';
import { localSupabase } from './test/integration/supabaseEnv';

/**
 * Opener rehearsal: a real browser (phone viewport) against the production build of the app and the
 * local Supabase stack. Run `npx -y supabase@2 db reset` first (the global setup refuses a dirty database),
 * then `pnpm e2e` from the repo root. Not part of `pnpm test`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const supabase = localSupabase();

// iPhone 14 is a WebKit device by default; only Chromium is installed here.
const { defaultBrowserType: _ignored, ...phone } = devices['iPhone 14'];

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { ...phone, browserName: 'chromium', deviceScaleFactor: 2, baseURL, trace: 'off', actionTimeout: 20_000, navigationTimeout: 30_000 },
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -H 127.0.0.1 -p ${PORT}`,
    url: `${baseURL}/login`,
    timeout: 6 * 60_000,
    reuseExistingServer: process.env.E2E_REUSE === '1',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceKey,
      MAILER: 'fake',
      APP_URL: baseURL,
    },
  },
});
