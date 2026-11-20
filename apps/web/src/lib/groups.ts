/**
 * Group sizes for `n` players: the fewest groups of at most `size`, sizes as even as possible
 * (10 -> 4,3,3; 12 -> 4,4,4; 6 -> 3,3), larger groups first.
 */
function groupSizes(n: number, size: number): number[] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Group size must be a positive integer');
  const count = Math.ceil(n / size);
  const base = Math.floor(n / Math.max(count, 1));
  const extra = n - base * count;
  return Array.from({ length: count }, (_, g) => base + (g < extra ? 1 : 0));
}

function chunk(ids: string[], sizes: number[]): string[][] {
  const groups: string[][] = [];
  let at = 0;
  for (const n of sizes) {
    groups.push(ids.slice(at, at + n));
    at += n;
  }
  return groups;
}

/** Random starting groups for the commissioner to adjust (see `groupSizes` for the sizes). */
export function suggestGroups(playerIds: string[], size = 4, rng: () => number = Math.random): string[][] {
  const sizes = groupSizes(playerIds.length, size);
  const ids = [...playerIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return chunk(ids, sizes);
}

export type PairingMethod = 'handicap' | 'balanced' | 'random';
export type PairingPlayer = { id: string; index: number | null };

/**
 * Pairings for a round. `handicap`: similar handicaps play together, lowest index first.
 * `balanced`: each group gets a mix of low and high (a snake through the field sorted by index).
 * `random`: shuffled. Players without an index sort last.
 */
export function pairGroups(
  players: PairingPlayer[],
  { method, size }: { method: PairingMethod; size: number },
  rng: () => number = Math.random,
): string[][] {
  if (method === 'random') return suggestGroups(players.map((p) => p.id), size, rng);
  const sorted = [...players]
    .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || a.id.localeCompare(b.id))
    .map((p) => p.id);
  const sizes = groupSizes(sorted.length, size);
  if (method === 'handicap') return chunk(sorted, sizes);
  const groups: string[][] = sizes.map(() => []);
  let g = 0;
  let dir = 1;
  for (const id of sorted) {
    // skip groups that are already full (uneven sizes), keeping the snake direction
    while (groups[g]!.length >= sizes[g]!) {
      g += dir;
      if (g < 0 || g >= groups.length) {
        dir = -dir;
        g += dir;
      }
    }
    groups[g]!.push(id);
    g += dir;
    if (g < 0 || g >= groups.length) {
      dir = -dir;
      g += dir;
    }
  }
  return groups;
}
