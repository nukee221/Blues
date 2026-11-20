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

export type PairingRule = { a: string; b: string; kind: 'together' | 'apart' };

/**
 * Adjusts made groups to meet pairing rules ("plays with" / "keep apart") with as few swaps as
 * possible: each swap is the one that breaks the fewest rules, preferring players of similar
 * handicap so the chosen pairing method still holds. Group sizes never change. Rules about
 * players not in the field are ignored; rules it cannot meet come back in `unmet`.
 */
export function applyPairingRules(
  start: string[][],
  rules: PairingRule[],
  index: Record<string, number | null | undefined>,
): { groups: string[][]; unmet: PairingRule[] } {
  const groups = start.map((g) => [...g]);
  const inField = new Set(groups.flat());
  const live = rules.filter((r) => inField.has(r.a) && inField.has(r.b) && r.a !== r.b);
  const where = () => {
    const m = new Map<string, number>();
    groups.forEach((g, i) => g.forEach((p) => m.set(p, i)));
    return m;
  };
  const broken = (m: Map<string, number>) =>
    live.filter((r) => (r.kind === 'together') !== (m.get(r.a) === m.get(r.b)));
  const hc = (p: string) => index[p] ?? 99;

  for (let pass = 0; pass < 50; pass++) {
    const m = where();
    const now = broken(m);
    if (now.length === 0) break;
    let best: { x: string; y: string; left: number; gap: number } | null = null;
    // try swapping either player of a broken rule with anyone in another group
    for (const r of now) {
      for (const x of [r.a, r.b]) {
        for (const y of inField) {
          if (m.get(y) === m.get(x)) continue;
          const trial = new Map(m);
          trial.set(x, m.get(y)!);
          trial.set(y, m.get(x)!);
          const left = broken(trial).length;
          const gap = Math.abs(hc(x) - hc(y));
          if (left < now.length && (!best || left < best.left || (left === best.left && gap < best.gap))) best = { x, y, left, gap };
        }
      }
    }
    if (!best) break;
    const gx = m.get(best.x)!;
    const gy = m.get(best.y)!;
    groups[gx] = groups[gx]!.map((p) => (p === best!.x ? best!.y : p));
    groups[gy] = groups[gy]!.map((p) => (p === best!.y ? best!.x : p));
  }
  return { groups, unmet: broken(where()) };
}
