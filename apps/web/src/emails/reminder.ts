/**
 * The evening-before reminder (6 PM Central). Escaped HTML string, email-safe styles, tour colors.
 * With groups out it carries the tee time and scorecard; before that, just the day and course.
 */
import { escapeHtml } from '@/emails/teeSheet';

export type ReminderEmailInput = {
  playerName: string;
  eventName: string;
  roundNumber: number;
  roundDate: string; // formatted
  courseName: string | null;
  teeName: string | null;
  /** Set once the tee sheet is out. */
  teeTime?: string | null;
  startHole?: number | null;
  groupMates?: string[];
  scorecardUrl?: string | null;
  eventUrl: string;
  appUrl: string;
};

export function reminderSubject(i: Pick<ReminderEmailInput, 'eventName' | 'roundNumber'>): string {
  return `Tomorrow: ${i.eventName}, round ${i.roundNumber}`;
}

const NAVY = '#0b2154';
const NAVY_DARK = '#0a1838';
const PANEL = '#14295a';
const RED = '#b5152b';
const GOLD = '#dbb847';
const SILVER = '#cbcfd7';
const HEAD = "font-family:Impact,'Arial Narrow Bold','Arial Black',sans-serif;font-style:italic;text-transform:uppercase;letter-spacing:0.5px";
const LABEL = `font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${SILVER}`;

function button(href: string, text: string, bg: string, fg = '#ffffff'): string {
  const e = escapeHtml;
  return `<a href="${e(href)}" style="display:block;padding:14px 16px;background:${bg};color:${fg};text-decoration:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;text-align:center;font-size:15px">${e(text)}</a>`;
}

export function renderReminderEmail(i: ReminderEmailInput): string {
  const e = escapeHtml;
  const where = [i.courseName, i.teeName ? `${i.teeName} tees` : null].filter(Boolean).join(' · ');
  const grouped = !!i.teeTime;
  const mates = (i.groupMates ?? []).map((m) => `<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.1);color:#fff">${e(m)}</div>`).join('');
  const buttons = [
    grouped && i.scorecardUrl ? button(i.scorecardUrl, 'Open scorecard', GOLD, NAVY_DARK) : '',
    button(i.eventUrl, 'Event page', RED),
  ]
    .filter(Boolean)
    .map((b) => `<tr><td style="padding:5px 0">${b}</td></tr>`)
    .join('');
  return [
    `<!doctype html><html><body style="margin:0;padding:0;background:${NAVY_DARK};font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#ffffff">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY_DARK}"><tr><td align="center" style="padding:16px 8px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${NAVY};border-radius:12px;overflow:hidden">`,
    `<tr><td style="padding:22px 20px 16px;text-align:center;border-bottom:3px solid ${GOLD}">`,
    `<img src="${e(i.appUrl)}/brand/shield-2027-transparent.png" width="80" height="78" alt="Huntsville Golf Tour" style="display:block;margin:0 auto 8px;border:0">`,
    `<div style="${LABEL};color:${GOLD}">See you tomorrow</div>`,
    `<div style="${HEAD};font-size:28px;color:#fff;margin-top:6px">${e(i.eventName)}</div>`,
    `<div style="display:inline-block;margin-top:10px;background:${RED};color:#fff;padding:5px 14px;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase">Round ${i.roundNumber}</div>`,
    `</td></tr>`,
    `<tr><td style="padding:18px 20px 4px;color:#fff">Hi ${e(i.playerName)}, a reminder that you play tomorrow.</td></tr>`,
    `<tr><td style="padding:8px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border-left:4px solid ${GOLD};border-radius:0 8px 8px 0">`,
    `<tr><td colspan="2" style="padding:12px 10px 4px"><div style="${LABEL}">Date</div><div style="${HEAD};font-size:20px;color:#fff">${e(i.roundDate)}</div></td></tr>`,
    grouped
      ? `<tr><td style="padding:6px 10px"><div style="${LABEL}">Tee time</div><div style="${HEAD};font-size:22px;color:${GOLD};white-space:nowrap">${e(i.teeTime!)}</div></td><td style="padding:6px 10px"><div style="${LABEL}">Start</div><div style="${HEAD};font-size:22px;color:#fff;white-space:nowrap">Hole ${i.startHole ?? 1}</div></td></tr>`
      : `<tr><td colspan="2" style="padding:6px 10px;color:${SILVER};font-size:14px">Tee times come with the tee sheet email.</td></tr>`,
    where ? `<tr><td colspan="2" style="padding:4px 10px 12px;color:${SILVER};font-size:14px">${e(where)}</td></tr>` : '',
    `</table></td></tr>`,
    mates ? `<tr><td style="padding:12px 20px 4px"><div style="${LABEL}">Your group</div>${mates}</td></tr>` : '',
    `<tr><td style="padding:14px 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${buttons}</table></td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('');
}
