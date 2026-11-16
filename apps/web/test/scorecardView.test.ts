import { describe, expect, it } from 'vitest';
import { liveMatch, matchLabel, netOnHole, playOrder } from '@/lib/scorecardView';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const empty = () => Array<number | null>(18).fill(null);

describe('scorecard view helpers', () => {
  it('plays from the start hole', () => {
    expect(playOrder(holes, 10).slice(0, 3)).toEqual([9, 10, 11]);
    expect(playOrder(holes, 10)[9]).toBe(0);
    expect(playOrder(holes, 1)[0]).toBe(0);
  });
  it('net subtracts strokes on the hole', () => {
    expect(netOnHole(5, 10, holes[0]!, 18)).toEqual({ strokes: 1, net: 4 });
    expect(netOnHole(5, 10, holes[10]!, 18)).toEqual({ strokes: 0, net: 5 });
    expect(netOnHole(null, 20, holes[0]!, 18)).toEqual({ strokes: 2, net: null });
  });
  it('names the leader and the winner', () => {
    expect(matchLabel({ up: 2, thru: 5, finished: false, winner: null, label: 'A 2 UP thru 5' }, 'Alex', 'Blake')).toBe('Alex 2 UP thru 5');
    expect(matchLabel({ up: -3, thru: 16, finished: true, winner: 'B', label: '3&2' }, 'Alex', 'Blake')).toBe('Blake wins 3&2');
    expect(matchLabel({ up: 0, thru: 4, finished: false, winner: null, label: 'AS thru 4' }, 'Alex', 'Blake')).toBe('AS thru 4');
  });
  it('uses match strokes (offLow) and the event setting', () => {
    const a = { id: 'a', name: 'Alex', playingHandicap: 10 };
    const b = { id: 'b', name: 'Blake', playingHandicap: 12 };
    const scores = { a: empty(), b: empty() };
    scores.a[0] = 4;
    scores.b[0] = 4; // SI 1: offLow gives Blake 2 strokes -> 1 on SI 1 -> Blake wins the hole
    expect(liveMatch({ players: [a, b], holes, startHole: 1, matchStrokes: 'offLow' }, scores)!.label).toBe('Blake 1 UP thru 1');
    // full: both get a stroke on SI 1 -> halved
    expect(liveMatch({ players: [a, b], holes, startHole: 1, matchStrokes: 'full' }, scores)!.label).toBe('AS thru 1');
    expect(liveMatch({ players: [a], holes, startHole: 1, matchStrokes: 'full' }, scores)).toBeNull();
  });
  it('counts a shotgun start from the start hole', () => {
    const a = { id: 'a', name: 'Alex', playingHandicap: 0 };
    const b = { id: 'b', name: 'Blake', playingHandicap: 0 };
    const scores = { a: empty(), b: empty() };
    scores.a[9] = 3;
    scores.b[9] = 4;
    expect(liveMatch({ players: [a, b], holes, startHole: 10, matchStrokes: 'full' }, scores)!.label).toBe('Alex 1 UP thru 1');
  });
});
