import { describe, expect, it } from 'vitest';
import { buildEventRows, eventLogo, ribbonText } from '@/lib/eventCards';

const ev = (id: string, name: string, status: string, dates: (string | null)[], format = 'stroke', course: string | null = 'Cherokee Ridge') => ({
  id, name, status, format,
  rounds: dates.map((play_date) => ({ play_date, tees: course ? { courses: { name: course } } : null })),
});

describe('eventLogo', () => {
  it('known events get their poster logo, everything else the tour flag', () => {
    expect(eventLogo('Masters 2027')).toBe('/brand/events/masters.png');
    expect(eventLogo('4th Huntsville Open')).toBe('/brand/events/huntsville-open.png');
    expect(eventLogo('Hackers Cup')).toBe('/brand/events/hackers-cup.png');
    expect(eventLogo('Season Championship')).toBe('/brand/flag-icon.png');
    expect(eventLogo('February Opener')).toBe('/brand/flag-icon.png');
  });
});

describe('buildEventRows', () => {
  const list = [
    ev('f', 'Winter Classic', 'final', ['2027-01-09']),
    ev('t', 'Season Championship', 'published', [null]),
    ev('m', 'Masters 2027', 'published', ['2027-04-10', '2027-04-11']),
    ev('o', '4th Huntsville Open', 'registration_closed', ['2027-06-05', '2027-06-06']),
    ev('d', 'Draft', 'draft', ['2027-03-01']),
    ev('x', 'Opener', 'in_progress', ['2027-02-20'], 'match_play'),
  ];
  const { upcoming, completed } = buildEventRows(list, 2027);

  it('upcoming soonest first, undated last, numbered from 01; drafts left out', () => {
    expect(upcoming.map((r) => [r.number, r.id])).toEqual([['01', 'x'], ['02', 'm'], ['03', 'o'], ['04', 't']]);
  });
  it('finished events listed separately, latest first', () => {
    expect(completed.map((r) => r.id)).toEqual(['f']);
  });
  it('format line: holes for stroke play, match play by name; course only once dated', () => {
    const m = upcoming.find((r) => r.id === 'm')!;
    expect(m.detail).toBe('36 holes');
    expect(upcoming.find((r) => r.id === 't')!.course).toBeNull();
    expect(m.course).toBe('Cherokee Ridge');
    expect(m.date).toBe('2027-04-10');
    expect(upcoming.find((r) => r.id === 'x')!.detail).toBe('Match play');
    expect(upcoming.find((r) => r.id === 't')!.date).toBeNull();
  });
  it("defending champion from last season's winners", () => {
    expect(upcoming.find((r) => r.id === 'm')!.defending?.champion).toBe('Terry Gaspich');
    expect(upcoming.find((r) => r.id === 'x')!.defending).toBeNull();
  });
});

describe('ribbonText', () => {
  it('"Titles to defend" until every upcoming event has a date, then "Who\'s next?"', () => {
    expect(ribbonText([{ date: '2027-04-10' }, { date: null }])).toBe('Titles to defend. Titles to take.');
    expect(ribbonText([{ date: '2027-04-10' }, { date: '2027-06-05' }])).toBe("Who's next?");
    expect(ribbonText([])).toBe('Titles to defend. Titles to take.');
  });
});
