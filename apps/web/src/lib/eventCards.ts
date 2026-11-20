import { defendingChampion, type Champion } from '@/lib/champions';

/** Logos cut from the 2027 season poster, matched by words in the event name. */
const LOGOS: [string, string][] = [
  ['masters', '/brand/events/masters.png'],
  ['huntsville open', '/brand/events/huntsville-open.png'],
  ['hackers cup', '/brand/events/hackers-cup.png'],
];
const DEFAULT_LOGO = '/brand/flag-icon.png';

export function eventLogo(name: string): string {
  const n = name.toLowerCase();
  return LOGOS.find(([k]) => n.includes(k))?.[1] ?? DEFAULT_LOGO;
}

type EventIn = {
  id: string;
  name: string;
  status: string;
  format: string | null;
  rounds: { play_date: string | null; tees?: unknown }[];
};

export type EventRow = {
  id: string;
  name: string;
  status: string;
  /** "01", "02", … in the order shown. */
  number: string;
  logo: string;
  /** First round's date, or null (TBA). */
  date: string | null;
  /** Courses in round order, each once (a 36- or 54-hole event can use two or three). */
  courses: string[];
  /** "36 holes" (stroke play) / "Match play". */
  detail: string;
  defending: Champion | null;
};

/** Each course once, in the order of the rounds' dates (undated rounds last). */
export function coursesInOrder(rounds: { play_date: string | null; tees?: unknown }[]): string[] {
  const sorted = [...rounds].sort((a, b) => (a.play_date ?? '9999').localeCompare(b.play_date ?? '9999'));
  return [...new Set(sorted.map((r) => courseOf(r.tees)).filter((c): c is string => !!c))];
}

const courseOf = (tees: unknown) => (tees as { courses?: { name?: string } | null } | null)?.courses?.name ?? null;

/**
 * The Events screen as poster rows: upcoming events (not draft, not final) soonest first with
 * undated ones last, numbered 01, 02, …; finished events separately, latest first.
 */
export function buildEventRows(events: EventIn[], seasonYear: number): { upcoming: EventRow[]; completed: EventRow[] } {
  const rows = events
    .filter((e) => e.status !== 'draft')
    .map((e) => {
      const dates = e.rounds.map((r) => r.play_date).filter((d): d is string => !!d).sort();
      const stroke = e.format !== 'match_play';
      return {
        id: e.id,
        name: e.name,
        status: e.status,
        number: '',
        logo: eventLogo(e.name),
        date: dates[0] ?? null,
        // Like the poster: courses are announced with the dates, so they show only once dated.
        courses: dates.length ? coursesInOrder(e.rounds) : [],
        detail: stroke ? `${e.rounds.length * 18} holes` : 'Match play',
        defending: defendingChampion(e.name, seasonYear),
      };
    });
  const byDate = (a: EventRow, b: EventRow) => (a.date ?? '9999').localeCompare(b.date ?? '9999');
  const upcoming = rows.filter((r) => r.status !== 'final').sort(byDate).map((r, i) => ({ ...r, number: String(i + 1).padStart(2, '0') }));
  const completed = rows.filter((r) => r.status === 'final').sort((a, b) => byDate(b, a));
  return { upcoming, completed };
}

/** The red ribbon on the Events screen, as on the season posters. */
export function ribbonText(upcoming: { date: string | null }[]): string {
  return upcoming.length > 0 && upcoming.every((r) => r.date) ? "Who's next?" : 'Titles to defend. Titles to take.';
}
