import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(route(`${O}/_next/static/chunks/main.js`, 'GET', 'no-cors', O)).toBe('static');
  });
  it('leaves everything else to the network', () => {
    expect(route(`${O}/c/ABC234`, 'POST', 'cors', O)).toBeNull(); // server actions
    expect(route(`${O}/c/ABC234?_rsc=1`, 'GET', 'cors', O)).toBeNull(); // RSC fetch, not a page load
    expect(route(`${O}/events`, 'GET', 'navigate', O)).toBeNull();
    expect(route(`${O}/cx`, 'GET', 'navigate', O)).toBeNull();
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
    expect(events).toEqual(['install', 'activate', 'fetch', 'message']);
  });
});

type Handler = (e: unknown) => void;
type Sandbox = {
  self: Record<string, unknown>;
  handlers: Record<string, Handler>;
  store: Map<string, Response>;
  fetch: ReturnType<typeof vi.fn>;
};

/** Run sw.js against an in-memory Cache API and a scripted fetch. */
function boot(): Sandbox {
  const handlers: Record<string, Handler> = {};
  const self: Record<string, unknown> = {
    addEventListener: (n: string, h: Handler) => void (handlers[n] = h),
    location: { origin: O },
    skipWaiting: vi.fn(),
  };
  const store = new Map<string, Response>();
  const keyOf = (r: string | Request) => (typeof r === 'string' ? r : r.url);
  const cache = {
    put: async (r: string | Request, res: Response) => void store.set(keyOf(r), res),
    match: async (r: string | Request) => store.get(keyOf(r))?.clone(),
  };
  const fetch = vi.fn();
  vm.runInNewContext(readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8'), {
    self,
    URL,
    Promise,
    Array,
    Set,
    String,
    setTimeout,
    fetch,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
  });
  return { self, handlers, store, fetch };
}
const basic = (body: string) => {
  const r = new Response(body, { status: 200 });
  Object.defineProperty(r, 'type', { value: 'basic' });
  return r;
};

describe('service worker precache and timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('only caches a /c/<code> document and /_next/static files of its own origin', () => {
    const { self } = boot();
    const ok = self.hgtCacheable as (u: string, o: string) => string | null;
    expect(ok(`${O}/c/ABC234`, O)).toBe(`${O}/c/ABC234`);
    expect(ok(`${O}/_next/static/chunks/a.js`, O)).toBe(`${O}/_next/static/chunks/a.js`);
    for (const bad of [`${O}/c`, `${O}/c/`, `${O}/admin`, `${O}/_next/image?x`, 'https://evil.test/c/ABC234', 'nope']) {
      expect(ok(bad, O)).toBeNull();
    }
  });

  it("a 'cache-urls' message fetches and stores the page and its static files, ignoring anything else", async () => {
    const sb = boot();
    sb.fetch.mockImplementation(async (u: string) => basic(`body of ${u}`));
    let done: Promise<unknown> = Promise.resolve();
    sb.handlers.message!({
      data: { type: 'cache-urls', urls: [`${O}/c/ABC234`, `${O}/_next/static/chunks/a.js`, `${O}/admin`, 'https://evil.test/_next/static/x.js'] },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    expect([...sb.store.keys()].sort()).toEqual([`${O}/_next/static/chunks/a.js`, `${O}/c/ABC234`]);
    expect(sb.fetch).toHaveBeenCalledTimes(2);
    // unknown messages are ignored
    sb.handlers.message!({ data: { type: 'other' }, waitUntil: () => { throw new Error('should not wait'); } });
  });

  it('one failed fetch does not stop the others', async () => {
    const sb = boot();
    sb.fetch.mockImplementation(async (u: string) => {
      if (u.endsWith('a.js')) throw new Error('offline');
      return basic('x');
    });
    let done: Promise<unknown> = Promise.resolve();
    sb.handlers.message!({
      data: { type: 'cache-urls', urls: [`${O}/_next/static/a.js`, `${O}/_next/static/b.js`] },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    expect([...sb.store.keys()]).toEqual([`${O}/_next/static/b.js`]);
  });

  const nav = (url: string) => ({ url, method: 'GET', mode: 'navigate' }) as unknown as Request;
  const respond = (sb: Sandbox, req: Request) => {
    let p!: Promise<Response>;
    sb.handlers.fetch!({ request: req, respondWith: (x: Promise<Response>) => (p = x) });
    return p;
  };

  it('network first: a fresh response is returned and stored', async () => {
    const sb = boot();
    sb.fetch.mockResolvedValue(basic('fresh'));
    const res = await respond(sb, nav(`${O}/c/ABC234`));
    expect(await res.text()).toBe('fresh');
    expect(sb.store.has(`${O}/c/ABC234`)).toBe(true);
  });

  it('falls back to the cache when the network fails, and errors when there is no cache', async () => {
    const sb = boot();
    sb.store.set(`${O}/c/ABC234`, basic('cached'));
    sb.fetch.mockRejectedValue(new TypeError('offline'));
    expect(await (await respond(sb, nav(`${O}/c/ABC234`))).text()).toBe('cached');
    await expect(respond(sb, nav(`${O}/c/ZZZ999`))).rejects.toThrow('offline');
  });

  it('a slow network (lie-fi) is abandoned after ~3 s for the cached copy', async () => {
    vi.useFakeTimers();
    const sb = boot();
    sb.store.set(`${O}/c/ABC234`, basic('cached'));
    sb.fetch.mockImplementation(() => new Promise(() => {})); // never answers
    const p = respond(sb, nav(`${O}/c/ABC234`));
    await vi.advanceTimersByTimeAsync(2900);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await (await p).text()).toBe('cached');
  });
});
