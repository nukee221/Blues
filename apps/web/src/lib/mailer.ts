import 'server-only';

export type MailMessage = { to: string; subject: string; html: string };
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
  /** Many messages; implementations may batch them into few requests. */
  sendBatch(msgs: MailMessage[]): Promise<void>;
}

/** Resend's batch endpoint takes at most 100 emails per request. */
export const RESEND_BATCH_LIMIT = 100;

/** Sends through the Resend HTTP API (no SDK). Throws on any non-2xx response. */
export function createResendMailer(apiKey: string, from: string): Mailer {
  async function post(path: string, body: unknown, what: string): Promise<void> {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Email ${what} failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
  const payload = (m: MailMessage) => ({ from, to: [m.to], subject: m.subject, html: m.html });
  return {
    async send(msg) {
      await post('/emails', payload(msg), `to ${msg.to}`);
    },
    async sendBatch(msgs) {
      for (let i = 0; i < msgs.length; i += RESEND_BATCH_LIMIT) {
        const chunk = msgs.slice(i, i + RESEND_BATCH_LIMIT);
        await post('/emails/batch', chunk.map(payload), `batch of ${chunk.length}`);
      }
    },
  };
}

/** Records messages instead of sending them (tests and local dev). */
export function createFakeMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push({ ...msg });
    },
    async sendBatch(msgs) {
      for (const m of msgs) sent.push({ ...m });
    },
  };
}

/**
 * MAILER=fake always gives the fake mailer. In production a missing RESEND_API_KEY throws
 * (no silent non-delivery); elsewhere it falls back to the fake mailer with a warning.
 */
export function getMailer(): Mailer {
  if (process.env.MAILER === 'fake') return createFakeMailer();
  const key = process.env.RESEND_API_KEY;
  if (!key || key === 'replace-me') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY is not set; set it, or MAILER=fake to disable email');
    }
    console.warn('[mailer] no RESEND_API_KEY; using fake mailer, no email will be delivered');
    return createFakeMailer();
  }
  return createResendMailer(key, process.env.MAIL_FROM || 'Huntsville Golf Tour <noreply@example.com>');
}
