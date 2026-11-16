import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeMailer, createResendMailer, getMailer } from '@/lib/mailer';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('createFakeMailer', () => {
  it('records sent messages', async () => {
    const m = createFakeMailer();
    await m.send({ to: 'a@x.test', subject: 'S', html: '<p>h</p>' });
    expect(m.sent).toEqual([{ to: 'a@x.test', subject: 'S', html: '<p>h</p>' }]);
  });
});

describe('createResendMailer', () => {
  it('POSTs to the Resend emails API with bearer auth', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createResendMailer('key-123', 'Tour <noreply@x.test>').send({ to: 'a@x.test', subject: 'S', html: '<p>h</p>' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
    expect(JSON.parse(init.body as string)).toEqual({ from: 'Tour <noreply@x.test>', to: ['a@x.test'], subject: 'S', html: '<p>h</p>' });
  });
  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 422 })));
    await expect(createResendMailer('k', 'f@x.test').send({ to: 'a@x.test', subject: 'S', html: 'h' })).rejects.toThrow(/422/);
  });
});

describe('sendBatch', () => {
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ to: `p${i}@x.test`, subject: 'S', html: `<p>${i}</p>` }));
  it('fake mailer records each message', async () => {
    const m = createFakeMailer();
    await m.sendBatch(msgs(3));
    expect(m.sent.map((x) => x.to)).toEqual(['p0@x.test', 'p1@x.test', 'p2@x.test']);
  });
  it('Resend posts to /emails/batch in chunks of at most 100', async () => {
    const fetchMock = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createResendMailer('k', 'Tour <noreply@x.test>').sendBatch(msgs(250));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(3);
    expect(calls.every(([url]) => url === 'https://api.resend.com/emails/batch')).toBe(true);
    const bodies = calls.map(([, init]) => JSON.parse(init.body as string) as { to: string[]; from: string }[]);
    expect(bodies.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(bodies.flat().map((b) => b.to[0])).toEqual(msgs(250).map((m) => m.to));
    expect(bodies[0]![0]).toEqual({ from: 'Tour <noreply@x.test>', to: ['p0@x.test'], subject: 'S', html: '<p>0</p>' });
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe('Bearer k');
  });
  it('makes no request for an empty batch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await createResendMailer('k', 'f@x.test').sendBatch([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('throws when a batch request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(createResendMailer('k', 'f@x.test').sendBatch(msgs(2))).rejects.toThrow(/429/);
  });
});

describe('getMailer', () => {
  it('throws in production without a RESEND_API_KEY', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MAILER', '');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(() => getMailer()).toThrow(/RESEND_API_KEY/);
    vi.stubEnv('RESEND_API_KEY', 'replace-me');
    expect(() => getMailer()).toThrow(/RESEND_API_KEY/);
  });
  it('is the fake mailer in production only with MAILER=fake', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MAILER', 'fake');
    vi.stubEnv('RESEND_API_KEY', '');
    expect('sent' in getMailer()).toBe(true);
  });
  it('is Resend in production with a key', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MAILER', '');
    vi.stubEnv('RESEND_API_KEY', 'real-key');
    expect('sent' in getMailer()).toBe(false);
  });
  it('is the fake mailer when MAILER=fake', () => {
    vi.stubEnv('MAILER', 'fake');
    vi.stubEnv('RESEND_API_KEY', 'real-key');
    expect('sent' in getMailer()).toBe(true);
  });
  it('is the fake mailer without a RESEND_API_KEY outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MAILER', '');
    vi.stubEnv('RESEND_API_KEY', '');
    expect('sent' in getMailer()).toBe(true);
  });
  it('is Resend when a key is set', () => {
    vi.stubEnv('MAILER', '');
    vi.stubEnv('RESEND_API_KEY', 'real-key');
    expect('sent' in getMailer()).toBe(false);
  });
});
