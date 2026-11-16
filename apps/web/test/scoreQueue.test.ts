import { describe, expect, it, vi } from 'vitest';
import { createScoreQueue, queueKey, type ScoreEntry } from '@/lib/scoreQueue';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const P1 = '44444444-4444-4444-8444-000000000001';
const P2 = '44444444-4444-4444-8444-000000000002';
const entry = (playerId: string, hole: number, gross: number, ts: string): ScoreEntry => ({
  playerId,
  hole,
  gross,
  clientTs: `2026-11-01T15:${ts}.000Z`,
});
const failing = () => vi.fn(async () => Promise.reject(new Error('offline')));
const settle = () => new Promise((r) => setTimeout(r, 0));
const CODE = 'ABC234';

describe('createScoreQueue', () => {
  it('offline queue survives reload and flushes once', async () => {
    const storage = memoryStorage();
    const q1 = createScoreQueue(storage, failing(), { code: CODE });
    q1.enqueue(entry(P1, 1, 4, '00:00'));
    q1.enqueue(entry(P2, 1, 5, '00:01'));
    q1.enqueue(entry(P1, 2, 3, '00:02'));
    await settle();
    expect(q1.pending()).toBe(3);

    const send = vi.fn(async (es: ScoreEntry[]) => ({ accepted: es.length }));
    const q2 = createScoreQueue(storage, send, { code: CODE }); // "reload"
    expect(q2.pending()).toBe(3);
    await q2.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(3);
    expect(q2.pending()).toBe(0);
    await q2.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stores entries per group code under hgt_queue_<code>', async () => {
    const storage = memoryStorage();
    const a = createScoreQueue(storage, failing(), { code: 'ABC234' });
    const b = createScoreQueue(storage, failing(), { code: 'XYZ789' });
    a.enqueue(entry(P1, 1, 4, '00:00'));
    await settle();
    expect(queueKey('ABC234')).toBe('hgt_queue_ABC234');
    expect(JSON.parse(storage.getItem('hgt_queue_ABC234')!)).toHaveLength(1);
    expect(storage.getItem('hgt_queue_XYZ789')).toBeNull();
    expect(b.pending()).toBe(0);
  });

  it('dedupes by (playerId, hole) keeping the newest clientTs', async () => {
    const storage = memoryStorage();
    const q = createScoreQueue(storage, failing(), { code: CODE });
    q.enqueue(entry(P1, 1, 4, '00:05'));
    q.enqueue(entry(P1, 1, 6, '00:01')); // older: ignored
    q.enqueue(entry(P2, 1, 5, '00:00'));
    q.enqueue(entry(P2, 1, 7, '00:09')); // newer: replaces
    await settle();
    expect(q.pending()).toBe(2);
    const send = vi.fn(async (es: ScoreEntry[]) => ({ accepted: es.length }));
    await createScoreQueue(storage, send, { code: CODE }).flush();
    const sent = send.mock.calls[0]![0];
    expect(sent.find((e) => e.playerId === P1)!.gross).toBe(4);
    expect(sent.find((e) => e.playerId === P2)!.gross).toBe(7);
  });

  it('does not start a second flush while one is in flight', async () => {
    const storage = memoryStorage();
    createScoreQueue(storage, failing(), { code: CODE }).enqueue(entry(P1, 1, 4, '00:00'));
    await settle();
    const d = deferred<{ accepted: number }>();
    const send = vi.fn(() => d.promise);
    const q = createScoreQueue(storage, send, { code: CODE });
    const f1 = q.flush();
    const f2 = q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    d.resolve({ accepted: 1 });
    await Promise.all([f1, f2]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.pending()).toBe(0);
  });

  it('removes exactly the sent entries: ones added (or re-scored) during the flight stay', async () => {
    const storage = memoryStorage();
    const seedQ = createScoreQueue(storage, failing(), { code: CODE });
    seedQ.enqueue(entry(P1, 1, 4, '00:00'));
    seedQ.enqueue(entry(P2, 1, 5, '00:00'));
    await settle();

    const first = deferred<{ accepted: number }>();
    const second = deferred<{ accepted: number }>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const q = createScoreQueue(storage, send, { code: CODE });
    const flight = q.flush();
    expect(send.mock.calls[0]![0]).toHaveLength(2);
    q.enqueue(entry(P1, 2, 3, '00:10')); // new hole during flight
    q.enqueue(entry(P2, 1, 6, '00:11')); // re-scored a hole that is in flight
    expect(q.pending()).toBe(3);
    first.resolve({ accepted: 2 });
    await flight;
    await settle();
    // The two queued during the flight survive and go out in a follow-up flush.
    expect(q.pending()).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual(
      expect.arrayContaining([entry(P1, 2, 3, '00:10'), entry(P2, 1, 6, '00:11')]),
    );
    second.resolve({ accepted: 2 });
    await settle();
    expect(q.pending()).toBe(0);
  });

  it('keeps entries when send fails, and flush rejects with the error', async () => {
    const storage = memoryStorage();
    const q = createScoreQueue(storage, failing(), { code: CODE });
    q.enqueue(entry(P1, 1, 4, '00:00'));
    await settle();
    await expect(q.flush()).rejects.toThrow('offline');
    expect(q.pending()).toBe(1);
  });

  it('notifies onChange with pending count and last error', async () => {
    const storage = memoryStorage();
    const onChange = vi.fn();
    const q = createScoreQueue(storage, failing(), { code: CODE, onChange });
    q.enqueue(entry(P1, 1, 4, '00:00'));
    await settle();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pending: 1, error: 'offline', sending: false }));
  });

  it('treats corrupt storage as an empty queue', () => {
    const storage = memoryStorage();
    storage.setItem(queueKey(CODE), '{not json');
    expect(createScoreQueue(storage, failing(), { code: CODE }).pending()).toBe(0);
  });
});
