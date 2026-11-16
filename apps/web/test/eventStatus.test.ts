import { describe, expect, it } from 'vitest';
import { EVENT_STATUSES, canTransition } from '@/lib/eventStatus';

const allowed = new Set([
  'draft>published',
  'published>registration_closed',
  'registration_closed>published',
  'registration_closed>in_progress',
  'in_progress>final',
  'final>in_progress',
]);

describe('canTransition', () => {
  for (const from of EVENT_STATUSES) {
    for (const to of EVENT_STATUSES) {
      const ok = allowed.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${ok ? 'allowed' : 'rejected'}`, () => {
        expect(canTransition(from, to)).toBe(ok);
      });
    }
  }
});
