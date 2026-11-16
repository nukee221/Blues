// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { saveEvent } = vi.hoisted(() => ({ saveEvent: vi.fn() }));
vi.mock('@/actions/events', () => ({ saveEvent }));
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
const props = { seasons: [{ id: initial.seasonId, year: 2027 }], tees: [{ id: tee, label: 'Course - Blue' }] };

beforeEach(() => saveEvent.mockReset());
afterEach(cleanup);

describe('EventForm after play starts', () => {
  it('keeps every field editable in an in-progress event', () => {
    const { container } = render(<EventForm initial={initial} status="in_progress" {...props} />);
    const selects = [...container.querySelectorAll('select')];
    // round 1 of a match-play event keeps its fixed stroke kind
    expect(selects.filter((s) => s.disabled)).toHaveLength(1);
    expect([...container.querySelectorAll('input')].every((i) => !i.disabled)).toBe(true);
    expect(screen.getByText('Add round')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });
  it('shows the confirm step on needs_confirm, and Continue resends with confirmResultsChange', async () => {
    saveEvent.mockResolvedValueOnce({ ok: false, code: 'needs_confirm', error: 'x', fields: ['allowance'] });
    saveEvent.mockResolvedValueOnce({ ok: true, data: { id: initial.id } });
    render(<EventForm initial={initial} status="final" {...props} />);
    fireEvent.click(screen.getByText('Save event'));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg.textContent).toContain('This changes results already recorded for this event (leaderboard, cut, match results, points).');
    expect(dlg.textContent).toContain('Handicaps already locked in on sent tee sheets stay as they were. Continue?');
    expect(dlg.textContent).toContain('allowance');
    expect(saveEvent.mock.calls[0]![0].confirmResultsChange).toBeUndefined();
    await waitFor(() => expect((screen.getByText('Continue') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(saveEvent).toHaveBeenCalledTimes(2));
    expect(saveEvent.mock.calls[1]![0].confirmResultsChange).toBe(true);
    const link = await screen.findByText('Recalculate points');
    expect(link.getAttribute('href')).toBe(`/admin/seasons/${initial.seasonId}/points`);
  });
  it('Cancel closes the confirm step without saving again; no recalc link for a non-final event', async () => {
    saveEvent.mockResolvedValue({ ok: false, code: 'needs_confirm', error: 'x', fields: ['format'] });
    render(<EventForm initial={initial} status="in_progress" {...props} />);
    fireEvent.click(screen.getByText('Save event'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(saveEvent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Recalculate points')).toBeNull();
  });
  it('other failures show their message, not the confirm step', async () => {
    saveEvent.mockResolvedValue({ ok: false, code: 'status_conflict', error: 'Event status changed concurrently' });
    render(<EventForm initial={initial} status="in_progress" {...props} />);
    fireEvent.click(screen.getByText('Save event'));
    await screen.findByText('Event status changed concurrently');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
