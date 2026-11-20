import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ path: '/events', getCurrentPlayer: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-hgt-path': h.path }) }));
vi.mock('@/lib/auth', () => ({ getCurrentPlayer: h.getCurrentPlayer }));
vi.mock('@/components/TabBar', () => ({ TabBar: () => <nav aria-label="Primary">tabs</nav> }));
vi.mock('../src/app/globals.css', () => ({}));
vi.mock('@fontsource-variable/inter', () => ({}));
vi.mock('@fontsource/anton/400.css', () => ({}));
vi.mock('@fontsource/oswald/500.css', () => ({}));
vi.mock('@fontsource/oswald/600.css', () => ({}));
vi.mock('@fontsource/oswald/700.css', () => ({}));

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

describe('root layout brand header', () => {
  it('shows the flag mark and the tour name, linking Home', async () => {
    const out = await html();
    expect(out).toContain('src="/brand/flag-icon.png"');
    expect(out.replace(/<[^>]+>/g, '')).toContain('Huntsville Golf Tour');
    expect(out).toMatch(/<a[^>]*href="\/"/);
  });
  it('the scorecard keeps the brand header (it holds nothing about the account)', async () => {
    h.path = '/c/ABC234';
    expect(await html()).toContain('src="/brand/flag-icon.png"');
    h.path = '/events';
  });
});

describe('root layout Home button', () => {
  it('signed-in pages get a Home button in the header', async () => {
    expect(await html()).toContain('aria-label="Home"');
  });
  it('the scorecard has no Home button (no account there)', async () => {
    h.path = '/c/ABC234';
    expect(await html()).not.toContain('aria-label="Home"');
    h.path = '/events';
  });
});

describe('root layout page style', () => {
  it('restyled screens draw on the dark background; others keep the light card', async () => {
    h.path = '/';
    expect(await html()).not.toContain('class="card p-4"');
    h.path = '/admin';
    expect(await html()).toContain('class="card p-4"');
    h.path = '/events';
  });
});
