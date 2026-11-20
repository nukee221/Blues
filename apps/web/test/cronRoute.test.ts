import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/mailer', () => ({ getMailer: () => ({}) }));
vi.mock('@/lib/reminders', async (orig) => ({ ...(await orig<typeof import('@/lib/reminders')>()), sendRoundReminders: h.send }));

import { GET } from '@/app/api/cron/reminders/route';

const call = (auth?: string) => GET(new Request('http://x/api/cron/reminders', { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret-value';
  process.env.APP_URL = 'https://tour.example.test';
  h.send.mockReset();
  h.send.mockResolvedValue({ rounds: 1, emails: 3 });
});
afterEach(() => vi.useRealTimers());

describe('/api/cron/reminders', () => {
  it('refuses calls without the secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call('Bearer s3cret-value')).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('sends at 6 PM Central', async () => {
    vi.useFakeTimers({ now: new Date('2027-04-09T23:05:00Z') });
    const r = await call('Bearer s3cret-value');
    expect(await r.json()).toEqual({ rounds: 1, emails: 3 });
    expect(h.send).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Date), 'https://tour.example.test');
  });
  it('the other daily run (7 PM in summer) does nothing', async () => {
    vi.useFakeTimers({ now: new Date('2027-04-10T00:05:00Z') });
    expect(await (await call('Bearer s3cret-value')).json()).toEqual({ skipped: 'not 6 PM Central' });
    expect(h.send).not.toHaveBeenCalled();
  });
});
