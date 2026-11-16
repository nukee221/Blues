import { TOUR_TZ } from '@/lib/time';

/** Points as stored and shown: always 2 decimals ("162.50"). */
export function formatPoints(n: number): string {
  return n.toFixed(2);
}

/**
 * The season the standings page opens on: this year's (US Central), else the latest season
 * before it, else the earliest one after it. Null when there are no seasons.
 */
export function pickCurrentSeason<T extends { year: number }>(seasons: T[], now: Date = new Date()): T | null {
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: TOUR_TZ, year: 'numeric' }).format(now));
  const sorted = [...seasons].sort((a, b) => a.year - b.year);
  return sorted.find((s) => s.year === year) ?? [...sorted].reverse().find((s) => s.year < year) ?? sorted[0] ?? null;
}
