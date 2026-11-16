import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateGroupCode } from '@/lib/codes';

describe('generateGroupCode', () => {
  it('is 6 chars from the alphabet', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    const code = generateGroupCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it('1,000 codes have no 0, O, 1, I, L', () => {
    for (let i = 0; i < 1000; i++) expect(generateGroupCode()).not.toMatch(/[0O1IL]/);
  });
  it('uses the injected rng (0 -> first letter, just under 1 -> last)', () => {
    expect(generateGroupCode(() => 0)).toBe('AAAAAA');
    expect(generateGroupCode(() => 0.999999)).toBe('999999');
  });
  it('is not constant across calls by default', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateGroupCode()));
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe('normalizeCode', () => {
  it('upper-cases and strips whitespace, returning null for anything outside the alphabet or length', async () => {
    const { normalizeCode } = await import('@/lib/codes');
    expect(normalizeCode(' abc 234\n')).toBe('ABC234');
    expect(normalizeCode('ABC234')).toBe('ABC234');
    expect(normalizeCode('ABC23')).toBeNull();
    expect(normalizeCode('ABC2345')).toBeNull();
    expect(normalizeCode('ABCO23')).toBeNull(); // O is not in the alphabet
    expect(normalizeCode('ABC-23')).toBeNull();
    expect(normalizeCode(42 as unknown as string)).toBeNull();
  });
});
