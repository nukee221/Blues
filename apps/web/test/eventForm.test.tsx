// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/actions/events', () => ({ saveEvent: vi.fn() }));
vi.mock('@/components/EventStatusButtons', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import EventForm from '@/components/EventForm';

const tee = '22222222-2222-4222-8222-222222222222';
const initial = {
  id: '33333333-3333-4333-8333-333333333333',
  seasonId: '11111111-1111-4111-8111-111111111111',
  name: 'Opener',
  eventType: 'match_play' as const,
  format: 'match_play' as const,
  handicapMode: 'net' as const,
  allowancePct: 100,
  handicapBasis: 'index' as const,
  matchStrokes: 'full' as const,
  registrationDeadline: '2027-04-01T12:00:00Z',
  rounds: [
    { roundNumber: 1, teeId: tee, playDate: '2027-04-10', kind: 'stroke' as const },
    { roundNumber: 2, teeId: tee, playDate: '2027-04-17', kind: 'match' as const },
  ],
};
const props = { seasons: [{ id: initial.seasonId, year: 2027 }], tees: [{ id: tee, label: 'Course – Blue' }] };

afterEach(cleanup);

describe('EventForm lock', () => {
  it('a locked event disables settings, tees and dated rounds with groups, with a note', () => {
    const { container } = render(<EventForm initial={initial} status="in_progress" locked roundsWithGroups={[1]} {...props} />);
    expect(screen.getByRole('note').textContent).toMatch(/Scoring has started/);
    const selects = [...container.querySelectorAll('select')];
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((s) => s.disabled)).toBe(true);
    const dates = [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
    expect(dates.map((d) => d.disabled)).toEqual([true, false]);
    expect((container.querySelector('input[type="datetime-local"]') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText('Add round')).toBeNull();
  });
  it('an unlocked event leaves everything editable', () => {
    const { container } = render(<EventForm initial={initial} status="published" {...props} />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(container.querySelector('select')!.disabled).toBe(false);
    expect(screen.getByText('Add round')).toBeTruthy();
  });
});
