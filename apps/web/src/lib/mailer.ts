import 'server-only';

export type MailMessage = { to: string; subject: string; html: string };
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** Sends through the Resend HTTP API (no SDK). Throws on any non-2xx response. */
export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Email to ${msg.to} failed (${res.status}): ${body.slice(0, 200)}`);
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
  };
}

/** Fake mailer when MAILER=fake or no real RESEND_API_KEY; otherwise Resend from MAIL_FROM. */
export function getMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  if (process.env.MAILER === 'fake' || !key || key === 'replace-me') {
    console.warn('[mailer] using fake mailer; no email will be delivered');
    return createFakeMailer();
  }
  return createResendMailer(key, process.env.MAIL_FROM || 'Huntsville Golf Tour <noreply@example.com>');
}
