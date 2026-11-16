// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/actions/signing', () => ({ adminEditScore: vi.fn(), adminSignCard: vi.fn(), reopenCard: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import CardAdmin from '@/components/CardAdmin';

afterEach(cleanup);

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const props = (players: { id: string; name: string; playingHandicap: number }[]) => ({
  groupId: 'g',
  locked: false,
  signedAt: null,
  scorerPlayerId: players[0]?.id ?? null,
  kind: 'match' as const,
  players,
  holes,
  scores: Object.fromEntries(players.map((p) => [p.id, Array(18).fill(null)])),
  signatures: [],
  startHole: 1,
  matchStrokes: 'full' as const,
});
const pl = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, playingHandicap: 0 }));

describe('CardAdmin', () => {
  it('warns when a match group does not have exactly two players', () => {
    render(<CardAdmin {...props(pl(3))} />);
    expect(screen.getByRole('alert').textContent).toMatch(/3 players.*exactly two players/);
  });

  it('no warning for a two-player match; score cells are 44px targets', () => {
    render(<CardAdmin {...props(pl(2))} />);
    expect(screen.queryByRole('alert')).toBeNull();
    const cell = screen.getByRole('button', { name: 'Edit Player 0 hole 1' });
    expect(cell.className).toMatch(/min-h-\[44px\]/);
    expect(cell.className).toMatch(/min-w-\[44px\]/);
  });
});
