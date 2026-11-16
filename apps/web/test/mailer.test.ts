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

describe('getMailer', () => {
  it('is the fake mailer when MAILER=fake', () => {
    vi.stubEnv('MAILER', 'fake');
    vi.stubEnv('RESEND_API_KEY', 'real-key');
    expect('sent' in getMailer()).toBe(true);
  });
  it('is the fake mailer without a RESEND_API_KEY', () => {
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
