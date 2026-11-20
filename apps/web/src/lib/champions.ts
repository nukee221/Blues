/**
 * Champions of past seasons, for the "Champions" strip and "Defending champion" lines.
 * 2026 was played before the app, so it is written here (from the 2027 season poster).
 * Later seasons can be added the same way until results come from the app itself.
 */
export type Champion = {
  year: number;
  /** The title as it was played that year, e.g. "3rd Huntsville Open". */
  title: string;
  champion: string;
  /** A second line: course, captain, etc. */
  note?: string;
  /** Lower-case words that identify the same event in a later season's event name. */
  matches: string[];
};

export const CHAMPIONS: Champion[] = [
  { year: 2026, title: 'Masters', champion: 'Terry Gaspich', matches: ['masters'] },
  { year: 2026, title: '3rd Huntsville Open', champion: 'Jeff Wolstenholme', matches: ['huntsville open'] },
  { year: 2026, title: 'Hackers Cup', champion: 'Team Blue', note: 'Capt. Walter King', matches: ['hackers cup'] },
];

export function championsFor(year: number): Champion[] {
  return CHAMPIONS.filter((c) => c.year === year);
}

/** Last season's winner of the event this name refers to, or null. */
export function defendingChampion(eventName: string, seasonYear: number): Champion | null {
  const name = eventName.toLowerCase();
  return championsFor(seasonYear - 1).find((c) => c.matches.some((m) => name.includes(m))) ?? null;
}
