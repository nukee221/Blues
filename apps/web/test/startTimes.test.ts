import { describe, expect, it } from 'vitest';
import { startTimes } from '@/lib/startTimes';

describe('start times', () => {
  it('tee times: first time plus a gap for each group', () => {
    expect(startTimes(3, { mode: 'interval', time: '08:00', gap: 10 })).toEqual([
      { teeTime: '08:00', startHole: 1 },
      { teeTime: '08:10', startHole: 1 },
      { teeTime: '08:20', startHole: 1 },
    ]);
    expect(startTimes(2, { mode: 'interval', time: '09:52', gap: 9 }).map((s) => s.teeTime)).toEqual(['09:52', '10:01']);
  });

  it('shotgun: everyone at the same time, holes 1, 2, 3 …', () => {
    expect(startTimes(3, { mode: 'shotgun', time: '08:30', gap: 10 })).toEqual([
      { teeTime: '08:30', startHole: 1 },
      { teeTime: '08:30', startHole: 2 },
      { teeTime: '08:30', startHole: 3 },
    ]);
  });

  it('shotgun with more than 18 groups: two groups share a hole, starting again at 1', () => {
    const s = startTimes(20, { mode: 'shotgun', time: '08:30', gap: 10 });
    expect(s.map((x) => x.startHole).slice(17)).toEqual([18, 1, 2]);
  });

  it('no time set: times stay empty', () => {
    expect(startTimes(2, { mode: 'interval', time: '', gap: 10 })).toEqual([
      { teeTime: '', startHole: 1 },
      { teeTime: '', startHole: 1 },
    ]);
  });
});
