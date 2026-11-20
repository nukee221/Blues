import { describe, expect, it } from 'vitest';
import { eventDayCounts, type DayGroup } from '@/lib/eventDay';

const g = (roundNumber: number, joined: boolean, scoring: boolean, signed: boolean): DayGroup => ({ roundNumber, joined, scoring, signed });

describe('event day live counts', () => {
  it('counts the groups of the round being played', () => {
    expect(eventDayCounts([g(1, true, true, true), g(1, true, true, false), g(1, false, false, false)])).toEqual({
      roundNumber: 1,
      total: 3,
      joined: 2,
      scoring: 2,
      signed: 1,
      allSigned: false,
    });
  });

  it('moves to round 2 once every round 1 card is signed', () => {
    const c = eventDayCounts([g(1, true, true, true), g(1, true, true, true), g(2, true, false, false), g(2, false, false, false)]);
    expect(c).toMatchObject({ roundNumber: 2, total: 2, joined: 1, scoring: 0, signed: 0, allSigned: false });
  });

  it('every card signed: stays on the last round and says so', () => {
    expect(eventDayCounts([g(2, true, true, true), g(1, true, true, true)])).toMatchObject({ roundNumber: 2, signed: 1, allSigned: true });
  });

  it('no groups: nothing to count', () => {
    expect(eventDayCounts([])).toBeNull();
  });
});
