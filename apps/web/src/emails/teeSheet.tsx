/**
 * Tee-sheet email. Built as an escaped HTML string rather than rendered JSX:
 * react-dom/server cannot be imported into App Router server code.
 * Email-safe: tables and inline styles only, in the tour colors (navy, red, gold).
 */
export type TeeSheetEmailInput = {
  playerName: string;
  eventName: string;
  roundNumber: number;
  roundDate: string; // already formatted (Central)
  teeTime: string; // already formatted (Central)
  startHole: number;
  groupMates: string[];
  code: string;
  /** The group's scorecard. */
  link: string;
  /** Locked-in for this round: index at send time and the playing handicap from it. */
  index?: string | null;
  playingHandicap?: string | null;
  /** 'gross': no strokes are given. */
  mode?: 'gross' | 'net' | null;
  teeName?: string | null;
  courseName?: string | null;
  /** Absolute URLs. */
  leaderboardUrl?: string;
  teeSheetUrl?: string;
  eventUrl?: string;
  /** The app's base URL, for the shield image. */
  appUrl?: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function teeSheetSubject(i: Pick<TeeSheetEmailInput, 'eventName' | 'roundNumber'>): string {
  return `Tee sheet: ${i.eventName}, round ${i.roundNumber}`;
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

export function renderTeeSheetEmail(i: TeeSheetEmailInput): string {
  const e = escapeHtml;
  const mates = i.groupMates.length
    ? i.groupMates.map((m) => `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.1);color:#fff">${e(m)}</div>`).join('')
    : `<div style="color:${SILVER}">No group mates.</div>`;
  const tees = [i.teeName ? `${i.teeName} tees` : null, i.courseName].filter(Boolean).join(' · ');
  const handicapCell =
    i.mode === 'gross'
      ? `<div style="${HEAD};font-size:22px;color:#fff">Gross: no strokes</div>`
      : `<div style="${HEAD};font-size:36px;color:${GOLD};line-height:1">${e(i.playingHandicap ?? '–')}</div><div style="${LABEL};margin-top:4px">Playing handicap</div>`;
  const cell = (label: string, value: string, size = 22, nowrap = true) =>
    `<td style="padding:10px 8px;vertical-align:top"><div style="${LABEL}">${label}</div><div style="${HEAD};font-size:${size}px;color:#fff;margin-top:2px${nowrap ? ';white-space:nowrap' : ''}">${value}</div></td>`;
  const links = [
    button(i.link, 'Open scorecard', GOLD, NAVY_DARK),
    i.leaderboardUrl ? button(i.leaderboardUrl, 'Leaderboard', RED) : '',
    i.teeSheetUrl ? button(i.teeSheetUrl, 'Full tee sheet', RED) : '',
    i.eventUrl ? button(i.eventUrl, 'Event page', 'transparent;border:2px solid rgba(255,255,255,0.3)') : '',
  ]
    .filter(Boolean)
    .map((b) => `<tr><td style="padding:5px 0">${b}</td></tr>`)
    .join('');
  return [
    `<!doctype html><html><body style="margin:0;padding:0;background:${NAVY_DARK};font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#ffffff">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY_DARK}"><tr><td align="center" style="padding:16px 8px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${NAVY};border-radius:12px;overflow:hidden">`,
    // Header: shield, tour name, event, red underline.
    `<tr><td style="padding:24px 20px 18px;text-align:center;border-bottom:3px solid ${GOLD}">`,
    i.appUrl ? `<img src="${e(i.appUrl)}/brand/shield-2027-transparent.png" width="96" height="94" alt="Huntsville Golf Tour" style="display:block;margin:0 auto 10px;border:0">` : '',
    `<div style="${LABEL};color:${GOLD}">Huntsville Golf Tour · Tee sheet</div>`,
    `<div style="${HEAD};font-size:30px;color:#fff;margin-top:6px">${e(i.eventName)}</div>`,
    `<div style="display:inline-block;margin-top:10px;background:${RED};color:#fff;padding:5px 14px;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase">Round ${i.roundNumber}</div>`,
    `</td></tr>`,
    `<tr><td style="padding:18px 20px 4px;color:#fff">Hi ${e(i.playerName)}, here is your tee time.</td></tr>`,
    // When and where.
    `<tr><td style="padding:8px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border-left:4px solid ${GOLD};border-radius:0 8px 8px 0">`,
    `<tr>${cell('Date', e(i.roundDate), 20, false).replace('<td ', '<td colspan="2" ')}</tr>`,
    `<tr>${cell('Tee time', e(i.teeTime))}${cell('Start', `Hole ${i.startHole}`)}</tr>`,
    tees ? `<tr><td colspan="2" style="padding:0 8px 12px;color:${SILVER};font-size:14px">${e(tees)}</td></tr>` : '',
    `</table></td></tr>`,
    // Locked-in handicap.
    `<tr><td style="padding:8px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border-radius:8px"><tr>`,
    `<td style="padding:14px 12px;vertical-align:middle">${handicapCell}</td>`,
    `<td style="padding:14px 12px;vertical-align:middle;text-align:right;color:${SILVER};font-size:13px">${i.index != null ? `Index ${e(i.index)}<br>` : ''}Locked in for this round</td>`,
    `</tr></table></td></tr>`,
    // Group.
    `<tr><td style="padding:12px 20px 4px"><div style="${LABEL}">Your group</div>${mates}</td></tr>`,
    // Code and buttons.
    `<tr><td style="padding:16px 20px 6px;text-align:center"><div style="${LABEL}">Group code</div><div style="${HEAD};font-size:40px;letter-spacing:6px;color:${GOLD};margin-top:4px">${e(i.code)}</div></td></tr>`,
    `<tr><td style="padding:6px 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${links}</table>`,
    `<p style="font-size:12px;color:${SILVER};margin:12px 0 0;text-align:center">Or go to ${e(i.link)}</p></td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('');
}
