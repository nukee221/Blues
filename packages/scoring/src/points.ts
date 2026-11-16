import type { Placing } from './types';

/** Default 500-point distribution, index 0 = 1st. Commissioners must verify against the current published FedExCup table. */
export const FEDEX_500: readonly number[] = [
  500, 300, 190, 135, 110, 100, 90, 85, 80, 75, 70, 65, 60, 57, 55, 53, 51, 49, 47, 45, 43, 41, 39,
  37, 35.5, 34, 32.5, 31, 29.5, 28,
];

/** Round to 2 decimals, half up on the cents. */
export function round2(n: number): number {
  return Math.round(n * 100 + 1e-9) / 100;
}

export function pointsTable(winnerPoints: number, base: readonly number[] = FEDEX_500): number[] {
  const scale = winnerPoints / 500;
  return base.map((v) => round2(v * scale));
}

/** Tied players share the average of the table values at the positions they occupy; missing entries count as 0. */
export function awardPoints(
  placings: Placing[],
  table: readonly number[],
): { playerId: string; points: number }[] {
  const counts = new Map<number, number>();
  for (const p of placings) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  return placings.map((p) => {
    const k = counts.get(p.position) ?? 1;
    let sum = 0;
    for (let i = 0; i < k; i++) sum += table[p.position - 1 + i] ?? 0;
    return { playerId: p.playerId, points: round2(sum / k) };
  });
}
