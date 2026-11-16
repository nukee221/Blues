/** The tour is in Huntsville, AL: every date/time the app shows or accepts is US Central. */
export const TOUR_TZ = 'America/Chicago';

/** e.g. "Feb 14, 2027, 11:59 PM CST". */
export function formatCentral(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TOUR_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TOUR_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Central wall-clock of an instant, as a UTC-ms number (for offset arithmetic). */
function centralWallAsUtc(ms: number): number {
  const p: Record<string, number> = {};
  for (const { type, value } of PARTS.formatToParts(new Date(ms))) p[type] = Number(value);
  return Date.UTC(p.year!, p.month! - 1, p.day, p.hour, p.minute, p.second);
}

/** ISO instant -> `datetime-local` value (YYYY-MM-DDTHH:mm) in Central. '' if invalid. */
export function isoToCentralInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(centralWallAsUtc(d.getTime())).toISOString().slice(0, 16);
}

/** `datetime-local` value typed as Central wall-clock -> UTC ISO instant (DST-correct). '' if invalid. */
export function centralInputToIso(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return '';
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let utc = wall;
  for (let i = 0; i < 2; i++) utc = wall - (centralWallAsUtc(utc) - utc);
  return new Date(utc).toISOString();
}
