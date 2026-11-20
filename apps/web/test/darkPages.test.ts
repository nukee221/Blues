import { describe, expect, it } from 'vitest';
import { isDarkPage } from '@/lib/darkPages';

describe('isDarkPage', () => {
  it('restyled screens', () => {
    for (const p of ['/', '/login', '/login?error=x', '/standings', '/standings/', '/me', '/events', '/events/abc', '/events/abc/tee-sheet']) expect(isDarkPage(p)).toBe(true);
  });
  it('everything else keeps the light card', () => {
    for (const p of ['/events/abc/leaderboard', '/events/abc/bracket', '/standings/p1', '/c/ABC234', '/admin', '/me/pin']) expect(isDarkPage(p)).toBe(false);
  });
});
