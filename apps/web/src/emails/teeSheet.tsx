/**
 * Tee-sheet email. Built as an escaped HTML string rather than rendered JSX:
 * react-dom/server cannot be imported into App Router server code.
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
  link: string;
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

export function renderTeeSheetEmail(i: TeeSheetEmailInput): string {
  const e = escapeHtml;
  const mates = i.groupMates.length
    ? `<ul>${i.groupMates.map((m) => `<li>${e(m)}</li>`).join('')}</ul>`
    : '<p>No group mates.</p>';
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">',
    `<p>Hi ${e(i.playerName)},</p>`,
    `<h1 style="font-size:20px;margin:0 0 8px">${e(i.eventName)}: round ${i.roundNumber}</h1>`,
    `<p><strong>${e(i.roundDate)}</strong><br>Tee time: <strong>${e(i.teeTime)}</strong><br>Start: <strong>Hole ${i.startHole}</strong></p>`,
    `<p>Your group:</p>${mates}`,
    `<p>Group code: <strong style="font-size:20px;letter-spacing:2px">${e(i.code)}</strong></p>`,
    `<p><a href="${e(i.link)}" style="display:inline-block;padding:12px 16px;background:#15803d;color:#fff;text-decoration:none;border-radius:6px">Open scorecard</a></p>`,
    `<p style="font-size:12px;color:#555">Or go to ${e(i.link)}</p>`,
    '</body></html>',
  ].join('');
}
