import { TOUR_TZ } from '@/lib/time';

/** Today's calendar day in Central time, as YYYY-MM-DD. */
export function centralToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TOUR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

type EventLike = { id: string; status: string; rounds: { play_date: string | null }[] };

/**
 * The event the Home screen shows next: one in progress first; else the open (not draft, not
 * final) event whose last round is today or later, soonest first; else an open event with no
 * dates yet. Null when there is none. `date` is the event's first round date (null if TBD).
 */
export function pickNextEvent<T extends EventLike>(events: T[], today: string): (T & { date: string | null }) | null {
  const open = events
    .filter((e) => e.status !== 'draft' && e.status !== 'final')
    .map((e) => {
      const dates = e.rounds.map((r) => r.play_date).filter((d): d is string => !!d).sort();
      return { e, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
    });
  const byFirst = (a: { first: string | null }, b: { first: string | null }) => (a.first ?? '').localeCompare(b.first ?? '');
  const pick =
    open.filter((x) => x.e.status === 'in_progress').sort(byFirst)[0] ??
    open.filter((x) => x.last && x.last >= today).sort(byFirst)[0] ??
    open.find((x) => !x.first);
  return pick ? { ...pick.e, date: pick.first } : null;
}

type StandingLike = { playerId: string; position: number; tied: boolean; total: number };

/** The player's place in the standings, with how many players are ranked; null with no points. */
export function findMyStanding(rows: StandingLike[], playerId: string) {
  const r = rows.find((x) => x.playerId === playerId);
  return r ? { position: r.position, tied: r.tied, total: r.total, of: rows.length } : null;
}
