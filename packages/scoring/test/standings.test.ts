import { describe, expect, test } from 'vitest';
import { seasonStandings, type Award } from '../src/standings';

describe('seasonStandings', () => {
  const awards: Award[] = [];
  for (let i = 1; i <= 9; i++) {
    awards.push({ playerId: `p${i}`, eventId: 'e1', points: 100 - i });
    awards.push({ playerId: `p${i}`, eventId: 'e2', points: 10 });
  }
  test('sums, sorts descending, flags qualified, lists byEvent', () => {
    const s = seasonStandings(awards);
    expect(s[0]).toMatchObject({ playerId: 'p1', total: 109, position: 1, qualified: true });
    expect(s[0]!.byEvent).toEqual([
      { eventId: 'e1', points: 99 },
      { eventId: 'e2', points: 10 },
    ]);
    expect(s[7]!.qualified).toBe(true);
    expect(s[8]).toMatchObject({ playerId: 'p9', position: 9, qualified: false });
  });
  test('ties share position and qualified at the line', () => {
    const s = seasonStandings(
      [
        { playerId: 'a', eventId: 'e', points: 5.1 },
        { playerId: 'a', eventId: 'f', points: 0.2 },
        { playerId: 'b', eventId: 'e', points: 5.3 },
        { playerId: 'c', eventId: 'e', points: 1 },
      ],
      2,
    );
    expect(s.map((r) => [r.playerId, r.position, r.tied, r.qualified])).toEqual([
      ['a', 1, true, true],
      ['b', 1, true, true],
      ['c', 3, false, false],
    ]);
    expect(s[0]!.total).toBe(5.3);
  });
});
