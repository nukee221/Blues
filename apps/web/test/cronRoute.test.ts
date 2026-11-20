import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/mailer', () => ({ getMailer: () => ({}) }));
vi.mock('@/lib/reminders', () => ({ sendDueReminders: h.send }));

import { GET } from '@/app/api/cron/reminders/route';

const call = (auth?: string) => GET(new Request('http://x/api/cron/reminders', { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret-value';
  process.env.APP_URL = 'https://tour.example.test';
  h.send.mockReset();
  h.send.mockResolvedValue({ rounds: 1, emails: 3 });
});

describe('/api/cron/reminders', () => {
  it('refuses calls without the secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call('Bearer s3cret-value')).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('with the secret, sends whatever is due', async () => {
    expect(await (await call('Bearer s3cret-value')).json()).toEqual({ rounds: 1, emails: 3 });
    expect(h.send).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Date), 'https://tour.example.test');
  });
});
