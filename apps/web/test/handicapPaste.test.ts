import { describe, expect, it } from 'vitest';
import { parseHandicapPaste } from '@/lib/handicapPaste';

const roster = [
  { id: 'a', name: 'John Smith' },
  { id: 'b', name: 'Jane Doe' },
];

describe('parseHandicapPaste', () => {
  it('matches tab-separated line', () => {
    const r = parseHandicapPaste('John Smith\t12.4', roster);
    expect(r.matched).toEqual([{ playerId: 'a', index: 12.4 }]);
    expect(r.unmatched).toEqual([]);
    expect(r.errors).toEqual([]);
  });
  it('plus handicap becomes negative; case and spaces ignored', () => {
    const r = parseHandicapPaste('jane  doe, +2.1', roster);
    expect(r.matched).toEqual([{ playerId: 'b', index: -2.1 }]);
  });
  it('accepts 2+ space separator and extra spaces inside names', () => {
    const r = parseHandicapPaste('  JOHN   SMITH   8', roster);
    expect(r.matched).toEqual([{ playerId: 'a', index: 8 }]);
  });
  it('reports unmatched names', () => {
    const r = parseHandicapPaste('Nobody Here\t5', roster);
    expect(r.unmatched).toEqual(['Nobody Here']);
    expect(r.matched).toEqual([]);
  });
  it('errors on out-of-range', () => {
    const r = parseHandicapPaste('Bob\t99', roster);
    expect(r.errors).toEqual([{ line: 1, message: expect.stringMatching(/range/i) }]);
    expect(parseHandicapPaste('John Smith, +10.1', roster).errors).toHaveLength(1);
    expect(parseHandicapPaste('John Smith, 54.1', roster).errors).toHaveLength(1);
    expect(parseHandicapPaste('John Smith, 54', roster).matched).toHaveLength(1);
    expect(parseHandicapPaste('John Smith, +10', roster).matched[0]!.index).toBe(-10);
  });
  it('errors on leading minus', () => {
    const r = parseHandicapPaste('John Smith\t-2.1', roster);
    expect(r.errors).toEqual([{ line: 1, message: 'Use + for plus handicaps' }]);
  });
  it('errors on non-numeric and missing index', () => {
    expect(parseHandicapPaste('John Smith\tabc', roster).errors).toHaveLength(1);
    expect(parseHandicapPaste('John Smith', roster).errors).toHaveLength(1);
  });
  it('ignores blank lines but keeps line numbers', () => {
    const r = parseHandicapPaste('\n\nJohn Smith\t5\n   \nJane Doe\tx', roster);
    expect(r.matched).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(5);
  });
  it('flags duplicate match', () => {
    const r = parseHandicapPaste('John Smith\t5\njohn smith\t6', roster);
    expect(r.matched).toEqual([{ playerId: 'a', index: 5 }]);
    expect(r.errors).toEqual([{ line: 2, message: 'Duplicate' }]);
  });
  it('rounds to one decimal', () => {
    expect(parseHandicapPaste('John Smith\t12.46', roster).matched[0]!.index).toBe(12.5);
  });
});
