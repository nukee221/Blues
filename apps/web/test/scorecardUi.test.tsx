// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GroupView } from '@/actions/scorecard';

const h = vi.hoisted(() => ({ openGroup: vi.fn(), saveScores: vi.fn(), claimScorer: vi.fn() }));
vi.mock('@/actions/scorecard', () => h);

import Scorecard from '@/app/c/[code]/Scorecard';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i === 0 ? 5 : 4, strokeIndex: i + 1 }));
const empty = () => Array<number | null>(18).fill(null);
const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 15, min)).toISOString();
const view = (over: Partial<GroupView> = {}): GroupView => ({
  asOf: at(0),
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

const live = (v: GroupView) => ({ ok: true as const, data: v });

describe('Scorecard', () => {
  it('first tap sets par, then +/- adjusts; entries queue, save, and the queue drains', async () => {
    h.openGroup.mockResolvedValue(live(view()));
    let release!: (v: unknown) => void;
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
    await waitFor(() => expect(h.saveScores).toHaveBeenCalledWith('ABC234', expect.any(Array)));
    // resolve every send (first flight and the follow-up carrying the newest value)
    h.saveScores.mockResolvedValue({ ok: true, data: { accepted: 1, rejected: [] } });
    await act(async () => release({ ok: true, data: { accepted: 1, rejected: [] } }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
    expect(localStorage.getItem('hgt_queue_ABC234')).toBeNull();
    const sent = h.saveScores.mock.calls.flatMap((c) => c[1] as { gross: number }[]);
    expect(sent.at(-1)).toMatchObject({ gross: 4 });
  });

  it('shows how many scores the server refused', async () => {
    h.openGroup.mockResolvedValue(live(view()));
    h.saveScores.mockResolvedValue({ ok: true, data: { accepted: 0, rejected: [{ playerId: 'a', hole: 1, reason: 'bad_hole' }] } });
    render(<Scorecard code="ABC234" initial={view()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner plus one' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/1 score was refused/);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('a scorer whose card gets locked re-reads the group and turns read-only (by code, not text)', async () => {
    h.openGroup.mockResolvedValueOnce(live(view()));
    h.saveScores.mockResolvedValue({ ok: false, code: 'locked', error: 'anything' });
    render(<Scorecard code="ABC234" initial={view()} />);
    await waitFor(() => expect(h.openGroup).toHaveBeenCalledTimes(1));
    h.openGroup.mockResolvedValue(live(view({ locked: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner plus one' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /plus one/ })).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Card is signed');
  });

  it('offline reload: the NEWER cached view renders over the stale HTML render, and is not overwritten', async () => {
    const newer = { a: empty(), b: empty() };
    newer.a[0] = 4;
    newer.b[0] = 5; // hole 1 already synced before the reload
    localStorage.setItem(
      'hgt_view_ABC234',
      JSON.stringify({ view: view({ asOf: at(30), eventName: 'Cached Opener', scores: newer }) }),
    );
    h.openGroup.mockRejectedValue(new TypeError('Failed to fetch'));
    h.saveScores.mockRejectedValue(new TypeError('Failed to fetch'));
    // The page HTML (from the service worker cache) carries an older render with no scores.
    render(<Scorecard code="ABC234" initial={view({ asOf: at(10), eventName: 'Stale Opener' })} />);
    expect(await screen.findByRole('heading', { name: 'Cached Opener' })).toBeTruthy();
    expect(await screen.findByText(/No signal/)).toBeTruthy();
    expect(screen.queryByText('Stale Opener')).toBeNull();
    // Synced scores are shown, not blank, and the card resumes at the first open hole.
    expect(screen.getByRole('heading', { name: 'Hole 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Prev' }));
    expect(screen.getByLabelText('Alex Turner gross').textContent).toBe('4');
    expect(screen.getByLabelText('Blake Morgan gross').textContent).toBe('5');
    // The cache still holds the newer view.
    const cached = JSON.parse(localStorage.getItem('hgt_view_ABC234')!).view as GroupView;
    expect(cached).toMatchObject({ asOf: at(30), eventName: 'Cached Opener' });
    // Scoring continues into the queue (and into the cached view).
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blake Morgan plus one' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Waiting for signal \(1\)/));
    expect(JSON.parse(localStorage.getItem('hgt_queue_ABC234')!)).toHaveLength(1);
    expect((JSON.parse(localStorage.getItem('hgt_view_ABC234')!).view as GroupView).scores.b![1]).toBe(4);
  });

  it('a score on screen is never blanked by an older view from a poll', async () => {
    const scores = { a: empty(), b: empty() };
    scores.a[0] = 4;
    h.openGroup.mockResolvedValue(live(view({ asOf: at(-5) }))); // older, empty
    render(<Scorecard code="ABC234" initial={view({ asOf: at(0), scores })} />);
    await waitFor(() => expect(h.openGroup).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByLabelText('Alex Turner gross').textContent).toBe('4');
  });

  it('shows the live match label using match strokes', async () => {
    const scores = { a: empty(), b: empty() };
    scores.a[0] = 5;
    scores.b[0] = 5; // Blake gets a stroke on SI 1
    const v = view({ scores });
    h.openGroup.mockResolvedValue(live(v));
    render(<Scorecard code="ABC234" initial={v} />);
    expect(await screen.findByText('Blake Morgan 1 UP thru 1')).toBeTruthy();
  });

  it('offers "Extra hole 19" when all square after 18 and scores it as hole 19', async () => {
    const v = view({
      players: [
        { id: 'a', name: 'Alex Turner', playingHandicap: 0 },
        { id: 'b', name: 'Blake Morgan', playingHandicap: 0 },
      ],
      scores: { a: Array(18).fill(4), b: Array(18).fill(4) },
    });
    h.openGroup.mockResolvedValue(live(v));
    h.saveScores.mockResolvedValue({ ok: true, data: { accepted: 1, rejected: [] } });
    render(<Scorecard code="ABC234" initial={v} />);
    expect(await screen.findByText('AS thru 18')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Extra hole 19' }));
    expect(screen.getByRole('heading', { name: 'Hole 19' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner plus one' })); // par of hole 1 = 5
    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner minus one' })); // 4
    fireEvent.click(screen.getByRole('button', { name: 'Alex Turner minus one' })); // 3
    fireEvent.click(screen.getByRole('button', { name: 'Blake Morgan plus one' })); // 5
    expect(screen.getByText('Alex Turner wins on 19th')).toBeTruthy();
    await waitFor(() =>
      expect(h.saveScores.mock.calls.flatMap((c) => c[1] as { hole: number }[]).some((e) => e.hole === 19)).toBe(true),
    );
  });

  it('read-only device has no +/- and offers to keep score when free', async () => {
    const v = view({ isScorerDevice: false, hasScorerDevice: false, scorerPlayerId: null });
    h.openGroup.mockResolvedValue(live(v));
    render(<Scorecard code="ABC234" initial={v} />);
    expect(screen.queryByRole('button', { name: /plus one/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/View only/);
    fireEvent.change(screen.getByRole('combobox', { name: 'Scorer' }), { target: { value: 'b' } });
    h.claimScorer.mockResolvedValue({ ok: false, code: 'other_device', error: 'Shown as given' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep score on this phone' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Shown as given');
    expect(h.claimScorer).toHaveBeenCalledWith('ABC234', 'b');
  });

  it('Next/Prev move through holes in playing order', async () => {
    h.openGroup.mockResolvedValue(live(view({ startHole: 10 })));
    render(<Scorecard code="ABC234" initial={view({ startHole: 10 })} />);
    expect(screen.getByRole('heading', { name: 'Hole 10' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('heading', { name: 'Hole 11' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Prev' }));
    fireEvent.click(screen.getByRole('button', { name: '← Prev' }));
    expect(screen.getByRole('heading', { name: 'Hole 9' })).toBeTruthy();
  });
});
