// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import RegisterServiceWorker, { loadedStaticUrls } from '@/app/c/RegisterServiceWorker';

describe('loadedStaticUrls', () => {
  it('keeps same-origin /_next/static resources only, deduplicated', () => {
    const o = 'https://tour.test';
    expect(
      loadedStaticUrls(
        [
          { name: `${o}/_next/static/chunks/a.js` },
          { name: `${o}/_next/static/chunks/a.js` },
          { name: '/_next/static/css/b.css' },
          { name: 'https://cdn.test/_next/static/c.js' },
          { name: `${o}/api/x` },
          { name: `${o}/c/ABC234` },
        ],
        o,
      ),
    ).toEqual([`${o}/_next/static/chunks/a.js`, `${o}/_next/static/css/b.css`]);
  });
});

describe('RegisterServiceWorker', () => {
  const postMessage = vi.fn();
  const register = vi.fn(async () => ({}));
  beforeEach(() => {
    postMessage.mockReset();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve({ active: { postMessage } }) },
    });
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: `${location.origin}/_next/static/chunks/a.js` },
      { name: `${location.origin}/favicon.ico` },
    ] as unknown as PerformanceEntryList);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it("on /c/<code> tells the active worker to cache this page and the static files it loaded", async () => {
    window.history.pushState({}, '', '/c/ABC234');
    render(<RegisterServiceWorker />);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/c/' });
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'cache-urls',
      urls: [`${location.origin}/c/ABC234`, `${location.origin}/_next/static/chunks/a.js`],
    });
  });
  it('on the /c code form it only registers (outside the worker scope, nothing to cache)', async () => {
    window.history.pushState({}, '', '/c');
    render(<RegisterServiceWorker />);
    expect(register).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
