// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  finalizeEvent: vi.fn(),
  setEventStatus: vi.fn(),
  drawEventBracket: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/actions/points', () => ({ finalizeEvent: h.finalizeEvent }));
vi.mock('@/actions/events', () => ({ setEventStatus: h.setEventStatus }));
vi.mock('@/actions/bracket', () => ({
  awardForfeit: vi.fn(),
  closePlayIn: vi.fn(),
  drawEventBracket: h.drawEventBracket,
  finalizeMatch: vi.fn(),
  setRoundDeadline: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import StandingsTable from '@/components/StandingsTable';
import EventStatusButtons from '@/components/EventStatusButtons';
import BracketAdmin from '@/components/BracketAdmin';
import type { StandingsEntry } from '@/actions/points';
import type { BracketView } from '@/actions/bracket';
import { formatPoints, pickCurrentSeason } from '@/lib/standings';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const entry = (i: number, total: number, position: number, tied = false): StandingsEntry => ({
  playerId: `p${i}`,
  name: `Player ${i}`,
  total,
  position,
  tied,
  qualified: position <= 8,
  eventsPlayed: 2,
  byEvent: [],
});

describe('StandingsTable', () => {
  const rows = [
    entry(1, 500, 1),
    entry(2, 162.5, 2, true),
    entry(3, 162.5, 2, true),
    ...[4, 5, 6, 7, 8, 9, 10].map((i) => entry(i, 100 - i, i)),
  ];

  it('Pos with T on ties, points to 2 decimals, events played; names link to the breakdown', () => {
    render(<StandingsTable rows={rows} me="nobody" />);
    const body = screen.getAllByRole('row');
    expect(within(body[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', 'Player 1', '500.00', '2']);
    expect(within(body[2]!).getAllByRole('cell')[0]!.textContent).toBe('T2');
    expect(within(body[2]!).getAllByRole('cell')[2]!.textContent).toBe('162.50');
    const link = screen.getByRole('link', { name: 'Player 3' });
    expect(link.getAttribute('href')).toBe('/standings/p3');
    expect(link.className).toMatch(/min-h-\[44px\]/);
  });

  it('a labelled "Season Championship cut" line directly under 8th', () => {
    render(<StandingsTable rows={rows} me="nobody" />);
    const all = screen.getAllByRole('row');
    const cut = screen.getByTestId('championship-cut');
    expect(cut.textContent).toBe('Season Championship cut');
    const at = all.indexOf(cut);
    expect(within(all[at - 1]!).getByRole('link').textContent).toBe('Player 8');
    expect(within(all[at + 1]!).getByRole('link').textContent).toBe('Player 9');
  });

  it("highlights the viewer's own row", () => {
    render(<StandingsTable rows={rows} me="p5" />);
    const mine = screen.getByRole('link', { name: /Player 5/ }).closest('tr')!;
    expect(mine.getAttribute('aria-current')).toBe('true');
    expect(mine.className).toMatch(/bg-yellow/);
    expect(mine.textContent).toMatch(/You/);
    expect(screen.getByRole('link', { name: 'Player 4' }).closest('tr')!.getAttribute('aria-current')).toBeNull();
  });

  it('empty season', () => {
    render(<StandingsTable rows={[]} me="p1" />);
    expect(screen.getByText(/No points awarded yet/)).toBeTruthy();
  });
});

describe('formatPoints / pickCurrentSeason', () => {
  it('2 decimals', () => {
    expect([formatPoints(500), formatPoints(96.25), formatPoints(0)]).toEqual(['500.00', '96.25', '0.00']);
  });
  it("this year's season (Central), else the latest before, else the first", () => {
    const s = [{ year: 2026 }, { year: 2027 }, { year: 2029 }];
    expect(pickCurrentSeason(s, new Date('2027-06-01T12:00:00Z'))).toEqual({ year: 2027 });
    expect(pickCurrentSeason(s, new Date('2028-06-01T12:00:00Z'))).toEqual({ year: 2027 });
    expect(pickCurrentSeason(s, new Date('2025-06-01T12:00:00Z'))).toEqual({ year: 2026 });
    // 2028-01-01 03:00 UTC is still 2027 in Huntsville.
    expect(pickCurrentSeason([{ year: 2027 }, { year: 2028 }], new Date('2028-01-01T03:00:00Z'))).toEqual({ year: 2027 });
    expect(pickCurrentSeason([])).toBeNull();
  });
});

describe('EventStatusButtons', () => {
  it('"Finalize" calls finalizeEvent (not a bare status change)', async () => {
    h.finalizeEvent.mockResolvedValue({ ok: true, data: { awards: [] } });
    render(<EventStatusButtons eventId="e1" status="in_progress" />);
    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    await waitFor(() => expect(h.finalizeEvent).toHaveBeenCalledWith('e1'));
    expect(h.setEventStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });
  it('shows a refusal such as bracket_incomplete', async () => {
    h.finalizeEvent.mockResolvedValue({ ok: false, code: 'bracket_incomplete', error: 'The bracket final has not been decided' });
    render(<EventStatusButtons eventId="e1" status="in_progress" />);
    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/final has not been decided/);
  });
  it('other transitions still use setEventStatus', async () => {
    h.setEventStatus.mockResolvedValue({ ok: true, data: null });
    render(<EventStatusButtons eventId="e1" status="final" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen (audited)' }));
    await waitFor(() => expect(h.setEventStatus).toHaveBeenCalledWith('e1', 'in_progress'));
    expect(h.finalizeEvent).not.toHaveBeenCalled();
  });
});

describe('BracketAdmin repair', () => {
  const view = (missingMatchRows: number): BracketView => ({
    eventId: 'e1',
    eventName: 'Opener',
    eventStatus: 'in_progress',
    closed: true,
    drawn: true,
    missingMatchRows,
    advanced: [],
    rounds: 0,
    matches: [],
    me: 'c',
    isCommissioner: true,
    names: {},
    playInTeeId: null,
  });
  it('"Repair bracket" shows only when a drawn bracket is missing match rows, and calls drawEventBracket', async () => {
    const { unmount } = render(<BracketAdmin view={view(0)} />);
    expect(screen.queryByRole('button', { name: 'Repair bracket' })).toBeNull();
    unmount();
    h.drawEventBracket.mockResolvedValue({ ok: true, data: {} });
    render(<BracketAdmin view={view(3)} />);
    const b = screen.getByRole('button', { name: 'Repair bracket' });
    expect(b.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(b);
    await waitFor(() => expect(h.drawEventBracket).toHaveBeenCalledWith('e1'));
  });
});
