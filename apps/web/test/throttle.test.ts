import { afterEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '@/lib/throttle';

afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('runs at most once per window, with a trailing run', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 2000);
    t.call();
    t.call();
    t.call();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
    t.call();
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('cancel drops the pending run', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 2000);
    t.call();
    t.call();
    t.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
