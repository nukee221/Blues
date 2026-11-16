import { describe, expect, test } from 'vitest';
import { FEDEX_500, awardPoints, pointsTable } from '../src/points';

describe('pointsTable', () => {
  test('scales base by winnerPoints/500', () => {
    const t = pointsTable(750);
    expect(t[0]).toBe(750);
    expect(t[1]).toBe(450);
  });
  test('rounds to 2 decimals', () => {
    expect(pointsTable(100)[24]).toBe(7.1);
    expect(pointsTable(1)[3]).toBe(0.27);
  });
  test('FEDEX_500 has 30 values', () => {
    expect(FEDEX_500).toHaveLength(30);
  });
});

describe('awardPoints', () => {
  test('ties share the average of occupied positions', () => {
    const r = awardPoints(
      [
        { playerId: 'a', position: 1, tied: false },
        { playerId: 'b', position: 2, tied: true },
        { playerId: 'c', position: 2, tied: true },
        { playerId: 'd', position: 4, tied: false },
      ],
      FEDEX_500,
    );
    expect(r.map((x) => x.points)).toEqual([500, 245, 245, 135]);
    expect(r.map((x) => x.playerId)).toEqual(['a', 'b', 'c', 'd']);
  });
  test('beyond table is 0; partially beyond averages with 0', () => {
    expect(awardPoints([{ playerId: 'a', position: 40, tied: false }], FEDEX_500)[0]!.points).toBe(0);
    const r = awardPoints(
      [
        { playerId: 'a', position: 2, tied: true },
        { playerId: 'b', position: 2, tied: true },
        { playerId: 'c', position: 2, tied: true },
      ],
      [10, 9, 6],
    );
    expect(r.map((x) => x.points)).toEqual([5, 5, 5]);
  });
  test('rounds to 2 decimals', () => {
    const r = awardPoints(
      [
        { playerId: 'a', position: 1, tied: true },
        { playerId: 'b', position: 1, tied: true },
        { playerId: 'c', position: 1, tied: true },
      ],
      [10, 5, 1],
    );
    expect(r[0]!.points).toBe(5.33);
  });
});
