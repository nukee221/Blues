import { describe, expect, it } from 'vitest';
import { centralToday, findMyStanding, pickNextEvent } from '@/lib/home';

const ev = (id: string, status: string, dates: (string | null)[]) => ({ id, status, rounds: dates.map((play_date) => ({ play_date })) });

describe('pickNextEvent', () => {
  it('picks the soonest event with a round today or later', () => {
    const list = [ev('a', 'published', ['2027-03-10']), ev('b', 'published', ['2027-02-20']), ev('c', 'published', ['2027-01-05'])];
    expect(pickNextEvent(list, '2027-02-01')?.id).toBe('b');
  });
  it('counts an event playing today, and a multi-round event still underway', () => {
    expect(pickNextEvent([ev('a', 'in_progress', ['2027-02-19', '2027-02-20'])], '2027-02-20')?.id).toBe('a');
  });
  it('skips final and draft events', () => {
    const list = [ev('f', 'final', ['2027-02-10']), ev('d', 'draft', ['2027-02-11']), ev('p', 'registration_closed', ['2027-02-12'])];
    expect(pickNextEvent(list, '2027-02-01')?.id).toBe('p');
  });
  it('an event in progress comes first even if its dates are past', () => {
    const list = [ev('late', 'in_progress', ['2027-01-30']), ev('soon', 'published', ['2027-02-02'])];
    expect(pickNextEvent(list, '2027-02-01')?.id).toBe('late');
  });
  it('falls back to an undated open event, else null', () => {
    expect(pickNextEvent([ev('x', 'published', [null])], '2027-02-01')?.id).toBe('x');
    expect(pickNextEvent([ev('old', 'published', ['2026-12-01'])], '2027-02-01')).toBeNull();
    expect(pickNextEvent([], '2027-02-01')).toBeNull();
  });
  it('returns the first date to show', () => {
    expect(pickNextEvent([ev('a', 'published', ['2027-03-02', '2027-03-01'])], '2027-02-01')?.date).toBe('2027-03-01');
  });
});

describe('centralToday', () => {
  it('uses the Central calendar day, not UTC', () => {
    expect(centralToday(new Date('2027-02-21T03:00:00Z'))).toBe('2027-02-20');
  });
});

describe('findMyStanding', () => {
  const rows = [
    { playerId: 'p1', position: 1, tied: false, total: 500 },
    { playerId: 'p2', position: 2, tied: true, total: 300 },
    { playerId: 'p3', position: 2, tied: true, total: 300 },
  ];
  it('finds the player and how many are ranked', () => {
    expect(findMyStanding(rows, 'p3')).toEqual({ position: 2, tied: true, total: 300, of: 3 });
  });
  it('is null when the player has no points', () => {
    expect(findMyStanding(rows, 'nobody')).toBeNull();
  });
});
