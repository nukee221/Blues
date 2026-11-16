/**
 * Random starting groups for the commissioner to adjust. Uses the fewest groups of at most
 * `size`, with sizes as even as possible (10 -> 4,3,3; 12 -> 4,4,4; 6 -> 3,3), larger groups first.
 */
export function suggestGroups(playerIds: string[], size = 4, rng: () => number = Math.random): string[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Group size must be a positive integer');
  const ids = [...playerIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const count = Math.ceil(ids.length / size);
  const base = Math.floor(ids.length / Math.max(count, 1));
  const extra = ids.length - base * count;
  const groups: string[][] = [];
  let at = 0;
  for (let g = 0; g < count; g++) {
    const n = base + (g < extra ? 1 : 0);
    groups.push(ids.slice(at, at + n));
    at += n;
  }
  return groups;
}
