import type { HoleInfo } from './types';
import { strokesOnHole } from './handicap';

export type MatchState = {
  /** > 0 means A leads, < 0 means B leads. */
  up: number;
  thru: number;
  finished: boolean;
  winner: 'A' | 'B' | 'halved' | null;
  label: string;
};

/** Match handicaps for each side. 'offLow': low player gets 0, the other the difference. */
export function matchStrokes(
  aPlaying: number,
  bPlaying: number,
  mode: 'full' | 'offLow',
): [number, number] {
  if (mode === 'full') return [aPlaying, bPlaying];
  const low = Math.min(aPlaying, bPlaying);
  return [aPlaying - low, bPlaying - low];
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function matchStatus(
  holes: HoleInfo[],
  aGross: (number | null)[],
  bGross: (number | null)[],
  aStrokes: number,
  bStrokes: number,
  opts: { allowExtraHoles: boolean },
): MatchState {
  const regulation = holes.length;
  const maxHoles = opts.allowExtraHoles ? Math.max(aGross.length, bGross.length) : regulation;
  let up = 0;
  let thru = 0;

  for (let i = 0; i < maxHoles; i++) {
    const hole = holes[i % regulation];
    const a = aGross[i];
    const b = bGross[i];
    if (!hole || a == null || b == null) break;
    const aNet = a - strokesOnHole(aStrokes, hole.strokeIndex);
    const bNet = b - strokesOnHole(bStrokes, hole.strokeIndex);
    if (aNet < bNet) up += 1;
    else if (bNet < aNet) up -= 1;
    thru = i + 1;

    const lead = Math.abs(up);
    const side = up > 0 ? 'A' : 'B';
    if (thru < regulation) {
      const remaining = regulation - thru;
      if (lead > remaining) {
        return { up, thru, finished: true, winner: side, label: `${lead}&${remaining}` };
      }
    } else if (thru === regulation) {
      if (lead > 0) {
        return { up, thru, finished: true, winner: side, label: `${lead} UP` };
      }
      if (!opts.allowExtraHoles) {
        return { up, thru, finished: true, winner: 'halved', label: 'Halved' };
      }
    } else if (lead > 0) {
      return { up, thru, finished: true, winner: side, label: `${side} wins on ${ordinal(thru)}` };
    }
  }

  let label: string;
  if (thru === 0) label = 'Not started';
  else if (up === 0) label = `AS thru ${thru}`;
  else label = `${up > 0 ? 'A' : 'B'} ${Math.abs(up)} UP thru ${thru}`;
  return { up, thru, finished: false, winner: null, label };
}
