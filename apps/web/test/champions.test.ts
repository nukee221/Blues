import { describe, expect, it } from 'vitest';
import { CHAMPIONS, championsFor, defendingChampion } from '@/lib/champions';

describe('past champions', () => {
  it('2026 has the three titles from the season poster', () => {
    expect(championsFor(2026).map((c) => [c.title, c.champion])).toEqual([
      ['Masters', 'Terry Gaspich'],
      ['3rd Huntsville Open', 'Jeff Wolstenholme'],
      ['Hackers Cup', 'Team Blue'],
    ]);
    expect(championsFor(1999)).toEqual([]);
  });
  it("finds last year's champion for this year's edition of an event", () => {
    expect(defendingChampion('Masters 2027', 2027)?.champion).toBe('Terry Gaspich');
    expect(defendingChampion('4th Huntsville Open', 2027)?.champion).toBe('Jeff Wolstenholme');
    expect(defendingChampion('Hackers Cup', 2027)?.champion).toBe('Team Blue');
    expect(defendingChampion('hackers cup 2027', 2027)?.champion).toBe('Team Blue');
  });
  it('no match for other events or seasons', () => {
    expect(defendingChampion('February Opener', 2027)).toBeNull();
    expect(defendingChampion('Masters 2027', 2028)).toBeNull();
  });
  it('every entry has a matching key', () => {
    for (const c of CHAMPIONS) expect(c.matches.length).toBeGreaterThan(0);
  });
});
