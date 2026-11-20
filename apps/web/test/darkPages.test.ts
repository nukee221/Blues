import { describe, expect, it } from 'vitest';
import { isDarkPage } from '@/lib/darkPages';

describe('isDarkPage', () => {
  it('restyled screens', () => {
    for (const p of ['/', '/login', '/login?error=x', '/standings', '/standings/', '/me', '/events', '/events/abc', '/events/abc/tee-sheet', '/events/abc/leaderboard', '/events/abc/bracket', '/c', '/c/ABC234']) expect(isDarkPage(p)).toBe(true);
  });
  it('everything else keeps the light card', () => {
    for (const p of ['/standings/p1', '/admin', '/me/pin']) expect(isDarkPage(p)).toBe(false);
  });
});
