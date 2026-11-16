import { describe, it, expect } from 'vitest';
import { matchStrokes, matchStatus } from '../src/matchPlay';
import type { HoleInfo } from '../src/types';

const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: 4,
  strokeIndex: i + 1,
}));

/** Build score arrays from per-hole results: 'A' A wins, 'B' B wins, 'H' halved, null not played. */
function play(results: ('A' | 'B' | 'H' | null)[]) {
  const a: (number | null)[] = [];
  const b: (number | null)[] = [];
  for (const r of results) {
    if (r === null) { a.push(null); b.push(null); }
    else if (r === 'A') { a.push(4); b.push(5); }
    else if (r === 'B') { a.push(5); b.push(4); }
    else { a.push(4); b.push(4); }
  }
  return { a, b };
}
const rep = (r: 'A' | 'B' | 'H', n: number) => Array<'A' | 'B' | 'H'>(n).fill(r);
const noExtra = { allowExtraHoles: false };

describe('matchStrokes', () => {
  it('offLow gives the difference to the higher player', () => {
    expect(matchStrokes(12, 5, 'offLow')).toEqual([7, 0]);
    expect(matchStrokes(5, 12, 'offLow')).toEqual([0, 7]);
    expect(matchStrokes(-2, 5, 'offLow')).toEqual([0, 7]);
  });
  it('full keeps both handicaps', () => {
    expect(matchStrokes(12, 5, 'full')).toEqual([12, 5]);
  });
});

describe('matchStatus', () => {
  it('not started', () => {
    const s = matchStatus(holes, [], [], 0, 0, noExtra);
    expect(s).toMatchObject({ up: 0, thru: 0, finished: false, winner: null, label: 'Not started' });
  });
  it('A 3 UP thru 12', () => {
    const { a, b } = play([...rep('A', 3), ...rep('H', 9)]);
    expect(matchStatus(holes, a, b, 0, 0, noExtra)).toEqual({
      up: 3, thru: 12, finished: false, winner: null, label: 'A 3 UP thru 12',
    });
  });
  it('B 2 UP thru 7', () => {
    const { a, b } = play([...rep('B', 2), ...rep('H', 5)]);
    const s = matchStatus(holes, a, b, 0, 0, noExtra);
    expect(s.up).toBe(-2);
    expect(s.label).toBe('B 2 UP thru 7');
  });
  it('all square', () => {
    const { a, b } = play(rep('H', 9));
    expect(matchStatus(holes, a, b, 0, 0, noExtra).label).toBe('AS thru 9');
  });
  it('dormie is not finished', () => {
    const { a, b } = play([...rep('A', 4), ...rep('H', 10)]);
    const s = matchStatus(holes, a, b, 0, 0, noExtra);
    expect(s.finished).toBe(false);
    expect(s.label).toBe('A 4 UP thru 14');
  });
  it('5&4 finishes the match', () => {
    const { a, b } = play([...rep('A', 5), ...rep('H', 9)]);
    expect(matchStatus(holes, a, b, 0, 0, noExtra)).toEqual({
      up: 5, thru: 14, finished: true, winner: 'A', label: '5&4',
    });
  });
  it('ignores scores after the match is decided', () => {
    const { a, b } = play([...rep('A', 5), ...rep('H', 9), ...rep('B', 4)]);
    const s = matchStatus(holes, a, b, 0, 0, noExtra);
    expect(s).toMatchObject({ up: 5, thru: 14, winner: 'A', label: '5&4' });
  });
  it('B wins early', () => {
    const { a, b } = play([...rep('B', 3), ...rep('H', 14)]);
    const s = matchStatus(holes, a, b, 0, 0, noExtra);
    expect(s).toMatchObject({ finished: true, winner: 'B', up: -3, label: '3&2' });
  });
  it('halved after 18', () => {
    const { a, b } = play(rep('H', 18));
    expect(matchStatus(holes, a, b, 0, 0, noExtra)).toEqual({
      up: 0, thru: 18, finished: true, winner: 'halved', label: 'Halved',
    });
  });
  it('1 UP after 18', () => {
    const { a, b } = play([...rep('A', 1), ...rep('H', 17)]);
    expect(matchStatus(holes, a, b, 0, 0, noExtra)).toMatchObject({
      up: 1, finished: true, winner: 'A', label: '1 UP',
    });
  });
  it('2 UP after 18 for B', () => {
    const { a, b } = play([...rep('H', 16), ...rep('B', 2)]);
    expect(matchStatus(holes, a, b, 0, 0, noExtra).label).toBe('2 UP');
  });
  it('extra hole win on 19th', () => {
    const { a, b } = play([...rep('H', 18), 'A']);
    expect(matchStatus(holes, a, b, 0, 0, { allowExtraHoles: true })).toMatchObject({
      winner: 'A', finished: true, thru: 19, label: 'A wins on 19th',
    });
  });
  it('extra holes: tied through 19 is AS thru 19, then B wins on 20th', () => {
    const o = { allowExtraHoles: true };
    let r = play(rep('H', 19));
    expect(matchStatus(holes, r.a, r.b, 0, 0, o)).toMatchObject({
      finished: false, winner: null, label: 'AS thru 19',
    });
    r = play([...rep('H', 19), 'B']);
    expect(matchStatus(holes, r.a, r.b, 0, 0, o)).toMatchObject({
      winner: 'B', label: 'B wins on 20th',
    });
  });
  it('all square after 18 with extra holes allowed but not played', () => {
    const { a, b } = play(rep('H', 18));
    expect(matchStatus(holes, a, b, 0, 0, { allowExtraHoles: true })).toMatchObject({
      finished: false, winner: null, thru: 18, label: 'AS thru 18',
    });
  });
  it('1 UP after 18 is final even with extra holes allowed', () => {
    const { a, b } = play([...rep('A', 1), ...rep('H', 17)]);
    expect(matchStatus(holes, a, b, 0, 0, { allowExtraHoles: true })).toMatchObject({
      finished: true, winner: 'A', label: '1 UP',
    });
  });
  it('net scoring: stroke on hole wins a gross tie', () => {
    // A has 1 stroke -> stroke index 1 hole only.
    const s = matchStatus(holes, [5], [5], 1, 0, noExtra);
    expect(s).toMatchObject({ up: 1, thru: 1, label: 'A 1 UP thru 1' });
  });
  it('thru stops at first hole missing a score', () => {
    const a = [4, 4, null, 4];
    const b = [4, 4, 4, 4];
    expect(matchStatus(holes, a, b, 0, 0, noExtra)).toMatchObject({ thru: 2, label: 'AS thru 2' });
  });
});
