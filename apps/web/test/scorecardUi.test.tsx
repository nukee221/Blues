// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GroupView } from '@/actions/scorecard';

const h = vi.hoisted(() => ({ openGroup: vi.fn(), saveScores: vi.fn(), claimScorer: vi.fn() }));
vi.mock('@/actions/scorecard', () => h);

import Scorecard from '@/app/c/[code]/Scorecard';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i === 0 ? 5 : 4, strokeIndex: i + 1 }));
const empty = () => Array<number | null>(18).fill(null);
const view = (over: Partial<GroupView> = {}): GroupView => ({
  groupId: 'g',
  locked: false,
  isScorerDevice: true,
  hasScorerDevice: true,
  scorerPlayerId: 'a',
  players: [
    { id: 'a', name: 'Alex Turner', playingHandicap: 0 },
    { id: 'b', name: 'Blake Morgan', playingHandicap: 2 },
  ],
  holes,
  scores: { a: empty(), b: empty() },
  kind: 'match',
  handicapMode: 'net',
  matchStrokes: 'full',
  startHole: 1,
  eventName: 'Spring Opener',
  roundNumber: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe('Scorecard', () => {
  it('first tap sets par, then +/- adjusts; entries queue and save', async () => {
    h.openGroup.mockResolvedValue(view());
    let release!: (v: { accepted: number }) => void;
    h.saveScores.mockImplementation(() => new Promise((r) => (release = r)));
    render(<Scorecard code="ABC234" initial={view()} />);
    await waitFor(() => expect(h.openGroup).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner plus one' }));
    expect(screen.getByLabelText('Alex Turner gross').textContent).toBe('5'); // par 5
    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner minus one' }));
    expect(screen.getByLabelText('Alex Turner gross').textContent).toBe('4');
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for signal \(1\)/);
    expect(JSON.parse(localStorage.getItem('hgt_queue_ABC234')!)).toEqual([
      expect.objectContaining({ playerId: 'a', hole: 1, gross: 4 }),
    ]);
    await act(async () => release({ accepted: 1 }));
    await waitFor(() => expect(h.saveScores).toHaveBeenCalledWith('ABC234', expect.any(Array)));
  });

  it('shows the live match label using match strokes', async () => {
    const scores = { a: empty(), b: empty() };
    scores.a[0] = 5;
    scores.b[0] = 5; // Blake gets a stroke on SI 1
    const v = view({ scores });
    h.openGroup.mockResolvedValue(v);
    render(<Scorecard code="ABC234" initial={v} />);
    expect(await screen.findByText('Blake Morgan 1 UP thru 1')).toBeTruthy();
  });

  it('read-only device has no +/- and offers to keep score when free', async () => {
    const v = view({ isScorerDevice: false, hasScorerDevice: false, scorerPlayerId: null });
    h.openGroup.mockResolvedValue(v);
    render(<Scorecard code="ABC234" initial={v} />);
    expect(screen.queryByRole('button', { name: /plus one/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/View only/);
    fireEvent.change(screen.getByRole('combobox', { name: 'Scorer' }), { target: { value: 'b' } });
    h.claimScorer.mockRejectedValue(new Error('Another phone is already keeping score for this group'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep score on this phone' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Another phone/);
    expect(h.claimScorer).toHaveBeenCalledWith('ABC234', 'b');
  });

  it('Next/Prev move through holes in playing order', async () => {
    h.openGroup.mockResolvedValue(view({ startHole: 10 }));
    render(<Scorecard code="ABC234" initial={view({ startHole: 10 })} />);
    expect(screen.getByRole('heading', { name: 'Hole 10' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('heading', { name: 'Hole 11' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Prev' }));
    fireEvent.click(screen.getByRole('button', { name: '← Prev' }));
    expect(screen.getByRole('heading', { name: 'Hole 9' })).toBeTruthy();
  });
});
