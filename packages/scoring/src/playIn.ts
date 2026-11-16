import type { LeaderboardRow } from './strokePlay';

export type PlayInRule = { threshold: number; below: number; atOrAbove: number };
export const DEFAULT_PLAY_IN: PlayInRule = { threshold: 16, below: 6, atOrAbove: 8 };

export function advanceCount(registered: number, rule: PlayInRule = DEFAULT_PLAY_IN): number {
  return registered >= rule.threshold ? rule.atOrAbove : rule.below;
}

export function playInCut(
  rows: LeaderboardRow[],
  count: number,
): { advanced: string[]; tiebreak: { spots: number; playerIds: string[] } | null } {
  if (rows.length <= count) return { advanced: rows.map((r) => r.playerId), tiebreak: null };
  const advanced: string[] = [];
  let i = 0;
  while (i < rows.length && advanced.length < count) {
    const pos = rows[i]!.position;
    let j = i;
    while (j < rows.length && rows[j]!.position === pos) j++;
    const group = rows.slice(i, j);
    if (advanced.length + group.length <= count) {
      advanced.push(...group.map((r) => r.playerId));
      i = j;
    } else {
      return {
        advanced,
        tiebreak: { spots: count - advanced.length, playerIds: group.map((r) => r.playerId) },
      };
    }
  }
  return { advanced, tiebreak: null };
}
