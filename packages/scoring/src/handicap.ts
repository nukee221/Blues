import type { TeeInfo } from './types';

export type HandicapBasis = 'index' | 'course';

/** Round half away from zero. */
function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Unrounded WHS course handicap: index * slope/113 + (rating - par). */
export function courseHandicapExact(index: number, tee: TeeInfo): number {
  return (index * tee.slope) / 113 + (tee.rating - tee.par);
}

export function playingHandicap(
  index: number,
  tee: TeeInfo,
  allowancePct: number,
  basis: HandicapBasis = 'index',
): number {
  const base = basis === 'course' ? courseHandicapExact(index, tee) : index;
  const r = roundHalfAway((base * allowancePct) / 100);
  return r === 0 ? 0 : r; // normalise -0
}

export function strokesOnHole(playing: number, strokeIndex: number, holeCount = 18): number {
  const base = Math.trunc(playing / holeCount);
  const r = playing - base * holeCount;
  let strokes = base;
  if (r > 0 && strokeIndex <= r) strokes += 1;
  if (r < 0 && strokeIndex > holeCount + r) strokes -= 1;
  return strokes === 0 ? 0 : strokes;
}

export function netScore(gross: number, strokes: number): number {
  return gross - strokes;
}
