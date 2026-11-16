import { describe, expect, test } from 'vitest';
import { courseHandicapExact, netScore, playingHandicap, strokesOnHole } from '../src/handicap';
import type { TeeInfo } from '../src/types';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
holes[0]!.par = 5; holes[1]!.par = 5; holes[2]!.par = 3; holes[3]!.par = 3; // 4*14+5+5+3+3 = 72
const tee: TeeInfo = { rating: 71.2, slope: 128, par: 72, holes };
const flat: TeeInfo = { ...tee, slope: 113, rating: 72 };

describe('handicap', () => {
  test('course handicap exact', () => expect(courseHandicapExact(10.4, tee)).toBeCloseTo(10.4 * 128 / 113 + (71.2 - 72), 6));
  test('index basis is the default and ignores slope', () => expect(playingHandicap(10.4, tee, 100)).toBe(10));
  test('index basis 85%', () => expect(playingHandicap(10.4, tee, 85)).toBe(9));
  test('course basis 100%', () => expect(playingHandicap(10.4, tee, 100, 'course')).toBe(11));
  test('course basis 85%', () => expect(playingHandicap(10.4, tee, 85, 'course')).toBe(9));
  test('half rounds away from zero', () => {
    expect(playingHandicap(4.5, flat, 100)).toBe(5);
    expect(playingHandicap(-4.5, flat, 100)).toBe(-5);
  });
  test('11 strokes land on SI 1-11', () => { expect(strokesOnHole(11, 11)).toBe(1); expect(strokesOnHole(11, 12)).toBe(0); });
  test('22 strokes: 2 on SI 1-4, 1 elsewhere', () => { expect(strokesOnHole(22, 4)).toBe(2); expect(strokesOnHole(22, 5)).toBe(1); });
  test('plus handicap gives back strokes on easiest holes', () => {
    expect(strokesOnHole(-2, 18)).toBe(-1); expect(strokesOnHole(-2, 17)).toBe(-1);
    expect(strokesOnHole(-2, 16)).toBe(0); expect(strokesOnHole(-2, 1)).toBe(0);
  });
  test('net', () => expect(netScore(5, 1)).toBe(4));
});
