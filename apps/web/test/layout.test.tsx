import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ path: '/events', getCurrentPlayer: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-hgt-path': h.path }) }));
vi.mock('@/lib/auth', () => ({ getCurrentPlayer: h.getCurrentPlayer }));
vi.mock('@/components/TabBar', () => ({ TabBar: () => <nav aria-label="Primary">tabs</nav> }));
vi.mock('../src/app/globals.css', () => ({}));

import RootLayout from '@/app/layout';

beforeEach(() => {
  h.getCurrentPlayer.mockReset();
  h.getCurrentPlayer.mockResolvedValue({ userId: 'u', player: { is_commissioner: true } });
});

const html = async () => renderToStaticMarkup(await RootLayout({ children: <p>page</p> }));

describe('root layout tab bar', () => {
  it('signed-in pages get the tab bar', async () => {
    expect(await html()).toContain('Primary');
  });
  it('/c/<code> renders without the account-specific nav, and never looks the account up', async () => {
    h.path = '/c/ABC234';
    const out = await html();
    expect(out).not.toContain('Primary');
    expect(out).toContain('page');
    expect(h.getCurrentPlayer).not.toHaveBeenCalled();
    h.path = '/events';
  });
  it('/c (enter a code) is outside the cached scope and keeps the tab bar', async () => {
    h.path = '/c';
    expect(await html()).toContain('Primary');
    h.path = '/events';
  });
});
