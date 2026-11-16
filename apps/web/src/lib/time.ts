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

/** A `date` column (YYYY-MM-DD, a calendar day, no zone) -> "Saturday, April 10, 2027". */
export function formatRoundDate(date: string | null): string {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Date TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)));
}

/**
 * A `time` column (Central wall-clock, HH:MM[:SS]) -> "8:10 AM CDT". With the play date the
 * zone abbreviation is the one in effect that day; without it, no zone is shown.
 */
export function formatTeeTime(playDate: string | null, teeTime: string | null): string {
  const t = teeTime?.match(/^(\d{2}):(\d{2})/);
  if (!t) return 'TBD';
  if (playDate && /^\d{4}-\d{2}-\d{2}$/.test(playDate)) {
    const iso = centralInputToIso(`${playDate}T${t[1]}:${t[2]}`);
    if (iso) {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: TOUR_TZ,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(iso));
    }
  }
  const h = Number(t[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${t[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
