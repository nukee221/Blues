/** Groups of a round in tee order: by tee time (TBD last), then starting hole. */
export function orderGroups<T extends { tee_time: string | null; start_hole: number }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => (a.tee_time ?? '99:99').localeCompare(b.tee_time ?? '99:99') || a.start_hole - b.start_hole);
}
