import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Route = (url: string, method: string, mode: string, origin: string) => 'page' | 'static' | null;

function loadRoute(): Route {
  const self: Record<string, unknown> = { addEventListener: vi.fn(), location: { origin: 'https://tour.test' } };
  vm.runInNewContext(readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8'), { self, URL });
  return self.hgtRoute as Route;
}

const O = 'https://tour.test';

describe('service worker routing', () => {
  const route = loadRoute();
  it('handles scorecard page loads and same-origin static assets', () => {
    expect(route(`${O}/c/ABC234`, 'GET', 'navigate', O)).toBe('page');
    expect(route(`${O}/c`, 'GET', 'navigate', O)).toBe('page');
    expect(route(`${O}/_next/static/chunks/main.js`, 'GET', 'no-cors', O)).toBe('static');
  });
  it('leaves everything else to the network', () => {
    expect(route(`${O}/c/ABC234`, 'POST', 'cors', O)).toBeNull(); // server actions
    expect(route(`${O}/c/ABC234?_rsc=1`, 'GET', 'cors', O)).toBeNull(); // RSC fetch, not a page load
    expect(route(`${O}/events`, 'GET', 'navigate', O)).toBeNull();
    expect(route(`${O}/courses`, 'GET', 'navigate', O)).toBeNull();
    expect(route(`${O}/admin`, 'GET', 'navigate', O)).toBeNull();
    expect(route(`https://cdn.example/_next/static/x.js`, 'GET', 'no-cors', O)).toBeNull();
    expect(route(`${O}/_next/image?url=x`, 'GET', 'no-cors', O)).toBeNull();
    expect(route('not a url', 'GET', 'navigate', O)).toBeNull();
  });
  it('registers install, activate and fetch handlers', () => {
    const self: Record<string, unknown> = { addEventListener: vi.fn(), location: { origin: O } };
    vm.runInNewContext(readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8'), { self, URL });
    const events = (self.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(events).toEqual(['install', 'activate', 'fetch']);
  });
});
