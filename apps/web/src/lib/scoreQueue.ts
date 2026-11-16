/**
 * Offline-first score queue for the group scorecard. Entries persist in `storage`
 * (localStorage in the browser) under `hgt_queue_<code>`, so a reload or a dead
 * signal loses nothing. One entry per (playerId, hole): the newest clientTs wins.
 */
export type ScoreEntry = { playerId: string; hole: number; gross: number; clientTs: string };
export type QueueState = { pending: number; sending: boolean; error: string | null };
export type SendScores = (entries: ScoreEntry[]) => Promise<{ accepted: number }>;

export const queueKey = (code: string) => `hgt_queue_${code}`;

const sameSlot = (a: ScoreEntry, b: ScoreEntry) => a.playerId === b.playerId && a.hole === b.hole;
const sameEntry = (a: ScoreEntry, b: ScoreEntry) => sameSlot(a, b) && a.gross === b.gross && a.clientTs === b.clientTs;
const isEntry = (e: unknown): e is ScoreEntry => {
  const x = e as ScoreEntry;
  return !!x && typeof x.playerId === 'string' && typeof x.hole === 'number' && typeof x.gross === 'number' && typeof x.clientTs === 'string';
};

export function createScoreQueue(
  storage: Storage,
  send: SendScores,
  opts: { code?: string; onChange?: (s: QueueState) => void } = {},
) {
  const key = opts.code ? queueKey(opts.code) : 'hgt_queue';
  let inFlight: Promise<void> | null = null;
  let again = false;
  let error: string | null = null;

  function read(): ScoreEntry[] {
    try {
      const raw = storage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }
  function write(list: ScoreEntry[]) {
    try {
      if (list.length) storage.setItem(key, JSON.stringify(list));
      else storage.removeItem(key);
    } catch {
      // Storage full or blocked: the in-memory copy is gone too, nothing better to do.
    }
  }
  const notify = () => opts.onChange?.({ pending: read().length, sending: inFlight !== null, error });

  async function run(): Promise<void> {
    const batch = read();
    if (batch.length === 0) return;
    try {
      await send(batch);
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save scores';
      again = false;
      throw e;
    }
    // Remove exactly what was sent; anything enqueued (or re-scored) meanwhile stays.
    write(read().filter((e) => !batch.some((b) => sameEntry(b, e))));
  }

  function flush(): Promise<void> {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    const p = run().finally(() => {
      inFlight = null;
      notify();
      if (again) {
        again = false;
        if (read().length) void flush().catch(() => {});
      }
    });
    inFlight = p;
    notify();
    return p;
  }

  function enqueue(entry: ScoreEntry) {
    const list = read();
    const t = Date.parse(entry.clientTs);
    const existing = list.find((e) => sameSlot(e, entry));
    if (existing && Date.parse(existing.clientTs) > t) return; // a newer value is already queued
    write([...list.filter((e) => !sameSlot(e, entry)), entry]);
    notify();
    void flush().catch(() => {}); // errors surface through onChange / the next explicit flush
  }

  return { enqueue, flush, pending: () => read().length, entries: read };
}

export type ScoreQueue = ReturnType<typeof createScoreQueue>;
