import { escapeHtml } from '@/emails/teeSheet';

/** Match-card email: the code and link for a bracket match both players scheduled. */
export type MatchCardEmailInput = {
  playerName: string;
  opponentName: string;
  eventName: string;
  matchLabel: string; // e.g. "Round 1, match 2"
  playDate: string; // already formatted
  course: string;
  code: string;
  link: string;
};

export function matchCardSubject(i: Pick<MatchCardEmailInput, 'eventName' | 'opponentName'>): string {
  return `Match card: ${i.eventName} vs ${i.opponentName}`;
}

export function renderMatchCardEmail(i: MatchCardEmailInput): string {
  const e = escapeHtml;
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">',
    `<p>Hi ${e(i.playerName)},</p>`,
    `<h1 style="font-size:20px;margin:0 0 8px">${e(i.eventName)}: ${e(i.matchLabel)}</h1>`,
    `<p>Your match against <strong>${e(i.opponentName)}</strong> has a scorecard.</p>`,
    `<p><strong>${e(i.playDate)}</strong><br>Course: <strong>${e(i.course)}</strong></p>`,
    `<p>Match code: <strong style="font-size:20px;letter-spacing:2px">${e(i.code)}</strong></p>`,
    `<p><a href="${e(i.link)}" style="display:inline-block;padding:12px 16px;background:#15803d;color:#fff;text-decoration:none;border-radius:6px">Open match card</a></p>`,
    `<p style="font-size:12px;color:#555">Or go to ${e(i.link)}</p>`,
    '</body></html>',
  ].join('');
}
