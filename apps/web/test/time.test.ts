import { describe, expect, it } from 'vitest';
import { centralInputToIso, formatCentral, isoToCentralInput } from '@/lib/time';

describe('time (America/Chicago)', () => {
  it('formats a winter instant in CST', () => {
    expect(formatCentral('2027-02-15T05:59:00Z')).toBe('Feb 14, 2027, 11:59 PM CST');
  });
  it('formats a summer instant in CDT', () => {
    expect(formatCentral('2027-07-10T17:00:00Z')).toBe('Jul 10, 2027, 12:00 PM CDT');
  });
  it('interprets typed wall-clock as CST (-06:00) in winter', () => {
    expect(centralInputToIso('2027-02-14T23:59')).toBe('2027-02-15T05:59:00.000Z');
  });
  it('interprets typed wall-clock as CDT (-05:00) in summer', () => {
    expect(centralInputToIso('2027-07-10T12:00')).toBe('2027-07-10T17:00:00.000Z');
  });
  it('handles days either side of DST changes', () => {
    expect(centralInputToIso('2027-03-14T01:30')).toBe('2027-03-14T07:30:00.000Z'); // before spring forward
    expect(centralInputToIso('2027-03-14T12:00')).toBe('2027-03-14T17:00:00.000Z'); // after
    expect(centralInputToIso('2027-11-07T12:00')).toBe('2027-11-07T18:00:00.000Z'); // after fall back
  });
  it('round-trips to the input value', () => {
    for (const v of ['2027-02-14T23:59', '2027-07-10T12:00', '2027-11-07T00:15']) {
      expect(isoToCentralInput(centralInputToIso(v))).toBe(v);
    }
  });
  it('rejects garbage', () => {
    expect(centralInputToIso('')).toBe('');
    expect(isoToCentralInput('nope')).toBe('');
  });
});

describe('round date and tee time (Central wall-clock)', () => {
  it('formats a play date without shifting the day', async () => {
    const { formatRoundDate } = await import('@/lib/time');
    expect(formatRoundDate('2027-04-10')).toBe('Saturday, April 10, 2027');
    expect(formatRoundDate(null)).toBe('Date TBD');
  });
  it('formats a tee time with the Central zone for that date', async () => {
    const { formatTeeTime } = await import('@/lib/time');
    expect(formatTeeTime('2027-04-10', '08:10:00')).toBe('8:10 AM CDT');
    expect(formatTeeTime('2027-01-09', '13:05')).toBe('1:05 PM CST');
    expect(formatTeeTime(null, '08:10:00')).toBe('8:10 AM');
    expect(formatTeeTime('2027-04-10', null)).toBe('TBD');
  });
});
