import { describe, expect, it } from 'vitest';
import { formatHandicap } from '@/lib/handicapFormat';

describe('formatHandicap', () => {
  it('shows plus handicaps with a plus sign', () => {
    expect(formatHandicap(-1)).toBe('+1');
    expect(formatHandicap(-1.2)).toBe('+1.2');
  });
  it('shows whole numbers without decimals and others with one', () => {
    expect(formatHandicap(12)).toBe('12');
    expect(formatHandicap(0)).toBe('0');
    expect(formatHandicap(8.4)).toBe('8.4');
    expect(formatHandicap(24)).toBe('24');
  });
  it('shows a dash when there is none', () => {
    expect(formatHandicap(null)).toBe('–');
    expect(formatHandicap(undefined)).toBe('–');
  });
});
