import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/lib/publicPaths';

describe('isPublicPath', () => {
  it('lets the group-code scorecard through without login', () => {
    expect(isPublicPath('/c')).toBe(true);
    expect(isPublicPath('/c/ABC234')).toBe(true);
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
    expect(isPublicPath('/sw.js')).toBe(true); // the scorecard's service worker
    expect(isPublicPath('/brand/flag-icon.png')).toBe(true); // brand artwork on the login page
    expect(isPublicPath('/api/cron/reminders')).toBe(true); // the scheduler; the route checks CRON_SECRET
  });
  it('does not open look-alike or private paths', () => {
    expect(isPublicPath('/courses')).toBe(false);
    expect(isPublicPath('/cx')).toBe(false);
    expect(isPublicPath('/events')).toBe(false);
    expect(isPublicPath('/enter-code')).toBe(false);
    expect(isPublicPath('/brandx')).toBe(false);
    expect(isPublicPath('/')).toBe(false);
  });
});
