'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { claimScorer, openGroup, saveScores, type GroupView } from '@/actions/scorecard';
import { unwrap } from '@/lib/actionResult';
import { SC } from '@/lib/scorecardCodes';
import { createScoreQueue, type QueueState, type ScoreQueue } from '@/lib/scoreQueue';
import { extraScored, holeAt, liveMatch, netOnHole, nextExtraHole, playOrder } from '@/lib/scorecardView';
import { loadGroupView, saveCachedView } from '@/lib/viewCache';

const FLUSH_MS = 15_000;
const POLL_READONLY_MS = 10_000;
const POLL_SCORER_MS = 30_000; // the scorer still needs to learn about a lock or a hand-off
type Grid = Record<string, (number | null)[]>;

/** localStorage, or a throwaway in-memory store where it is blocked (private mode). */
function browserStorage(): Storage {
  try {
    const t = '__hgt_probe__';
    window.localStorage.setItem(t, t);
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch {
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
}

const copyGrid = (g: Grid): Grid => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, [...v]]));

/** Score slot for a hole number (extra hole 19 + k sits at holes.length + k). */
const slotOf = (view: GroupView, hole: number) =>
  hole > 18 ? view.holes.length + (hole - 19) : view.holes.findIndex((h) => h.number === hole);

/** Server scores with this device's unsent entries on top. */
function withPending(view: GroupView, queue: ScoreQueue | null): Grid {
  const grid = copyGrid(view.scores);
  for (const e of queue?.entries() ?? []) {
    const i = slotOf(view, e.hole);
    const row = grid[e.playerId];
    if (i >= 0 && row) {
      while (row.length <= i) row.push(null);
      row[i] = e.gross;
    }
  }
  return grid;
}

function firstOpenHole(view: GroupView, grid: Grid): number {
  const order = playOrder(view.holes, view.startHole);
  return order.find((i) => view.players.some((p) => grid[p.id]?.[i] == null)) ?? order[0] ?? 0;
}

export default function Scorecard({ code, initial }: { code: string; initial: GroupView }) {
  const [view, setView] = useState(initial);
  const [grid, setGrid] = useState<Grid>(() => copyGrid(initial.scores));
  const [idx, setIdx] = useState(() => firstOpenHole(initial, initial.scores));
  const [extrasShown, setExtrasShown] = useState(0);
  const [queueState, setQueueState] = useState<QueueState>({ pending: 0, sending: false, error: null, errorCode: null, dropped: 0 });
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const [claimFor, setClaimFor] = useState(initial.scorerPlayerId ?? '');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const queueRef = useRef<ScoreQueue | null>(null);
  const storageRef = useRef<Storage | null>(null);
  const lastTs = useRef(0);
  const lastEditAt = useRef(0);

  const canEdit = view.isScorerDevice && !view.locked;
  const hole = holeAt(view.holes, idx);
  const extras = Math.max(extrasShown, extraScored(view.holes, grid));
  const slots = useMemo(
    () => [...playOrder(view.holes, view.startHole), ...Array.from({ length: extras }, (_, k) => view.holes.length + k)],
    [view.holes, view.startHole, extras],
  );
  const pos = Math.max(0, slots.indexOf(idx));

  const apply = useCallback((next: GroupView, startedAt: number) => {
    if (lastEditAt.current > startedAt && next.isScorerDevice && !next.locked) {
      // A tap landed while this read was in flight: keep the local grid, take the rest.
      setView((v) => ({ ...next, scores: v.scores }));
      return;
    }
    setView(next);
    setGrid(next.isScorerDevice && !next.locked ? withPending(next, queueRef.current) : copyGrid(next.scores));
  }, []);

  const refresh = useCallback(async () => {
    const storage = storageRef.current;
    if (!storage) return;
    const startedAt = Date.now();
    const r = await loadGroupView(() => openGroup(code), storage, code);
    if (r.source === 'live' || r.source === 'cache') {
      setOffline(r.source === 'cache');
      apply(r.view, startedAt);
    } else if (r.source === 'offline') setOffline(true);
    else if (r.code === SC.notFound) setGone(true);
  }, [code, apply]);

  // Browser-only state, once per code: storage, the queue, the cached view.
  useEffect(() => {
    const storage = browserStorage();
    storageRef.current = storage;
    saveCachedView(storage, code, initial);
    const q = createScoreQueue(storage, async (entries) => unwrap(await saveScores(code, entries)), {
      code,
      onChange: setQueueState,
    });
    queueRef.current = q;
    setQueueState((s) => ({ ...s, pending: q.pending() }));
    // The server render could not set the device cookie; this call does, and folds in unsent entries.
    void refresh();
    return () => {
      queueRef.current = null;
    };
    // `initial` is deliberately not a dependency: it is the server render for this code,
    // and later views come from refresh().
  }, [code, refresh]);

  // Scorer: flush on reconnect and every 15 s.
  useEffect(() => {
    if (!canEdit) return;
    const flush = () => void queueRef.current?.flush().catch(() => {});
    flush();
    const timer = window.setInterval(flush, FLUSH_MS);
    window.addEventListener('online', flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [canEdit]);

  // Everyone polls (anonymous code holders cannot use realtime under RLS): read-only
  // phones every 10 s, the scorer every 30 s; and on focus.
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), view.isScorerDevice ? POLL_SCORER_MS : POLL_READONLY_MS);
    const onFocus = () => void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [view.isScorerDevice, refresh]);

  // A save refused for good (card signed, phone handed off): re-read who may edit.
  useEffect(() => {
    if (queueState.errorCode === SC.locked || queueState.errorCode === SC.notScorer) void refresh();
  }, [queueState.errorCode, refresh]);

  function bump(playerId: string, delta: 1 | -1) {
    if (!canEdit) return;
    const current = grid[playerId]?.[idx] ?? null;
    const gross = current == null ? hole.par : Math.min(15, Math.max(1, current + delta));
    if (gross === current) return;
    lastEditAt.current = Date.now();
    setGrid((g) => {
      const next = copyGrid(g);
      const row = next[playerId]!;
      while (row.length <= idx) row.push(null);
      row[idx] = gross;
      return next;
    });
    const t = Math.max(Date.now(), lastTs.current + 1); // strictly increasing per device
    lastTs.current = t;
    queueRef.current?.enqueue({ playerId, hole: hole.number, gross, clientTs: new Date(t).toISOString() });
  }

  async function claim() {
    if (!claimFor) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const r = await claimScorer(code, claimFor);
      if (r.ok) await refresh();
      else {
        setClaimError(r.error);
        if (r.code === SC.otherDevice || r.code === SC.locked) await refresh();
      }
    } catch {
      setClaimError('No signal. Try again when you have a connection.');
    } finally {
      setClaiming(false);
    }
  }

  function addExtraHole() {
    const slot = view.holes.length + extras;
    setExtrasShown(extras + 1);
    setIdx(slot);
  }

  if (gone) {
    return (
      <p role="alert" className="text-xl font-semibold text-red-800">
        This group no longer exists. Ask the commissioner for the current code.
      </p>
    );
  }

  const go = (step: 1 | -1) => setIdx(slots[(pos + step + slots.length) % slots.length]!);
  const match = view.kind === 'match' ? liveMatch(view, grid) : null;
  const extraOffer = canEdit ? nextExtraHole(view, grid, extrasShown) : null;
  const net = view.handicapMode === 'net';
  const totals = (pid: string) => {
    let gross = 0;
    let nett = 0;
    let n = 0;
    const ph = view.players.find((p) => p.id === pid)!.playingHandicap;
    view.holes.forEach((h, i) => {
      const g = grid[pid]?.[i];
      if (g == null) return;
      gross += g;
      nett += netOnHole(g, ph, h, view.holes.length).net!;
      n += 1;
    });
    return { gross, net: nett, n };
  };
  const assignedName = view.players.find((p) => p.id === view.scorerPlayerId)?.name;

  let status: string;
  if (view.locked) status = 'Card is signed';
  else if (!view.isScorerDevice) status = offline ? 'Offline · view only' : 'View only · updates every 10 s';
  else if (queueState.pending > 0 && queueState.errorCode) status = `Not saved: ${queueState.error} (${queueState.pending})`;
  else if (queueState.pending > 0) status = `Waiting for signal (${queueState.pending})`;
  else status = 'Saved';
  const statusOk = status === 'Saved';

  const btn = 'flex min-h-[56px] min-w-[56px] items-center justify-center rounded-lg text-2xl font-bold';

  return (
    <div className="space-y-4 text-slate-950">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold leading-tight">{view.eventName}</h1>
          <p className="text-base font-semibold">
            Round {view.roundNumber} · {view.kind === 'match' ? 'Match play' : 'Stroke play'}
            {net ? ' · net' : ' · gross'}
          </p>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`rounded px-2 py-1 text-right text-sm font-bold ${
            statusOk ? 'bg-green-800 text-white' : view.isScorerDevice && !view.locked ? 'bg-yellow-300 text-slate-950' : 'bg-slate-200'
          }`}
        >
          {status}
        </p>
      </header>

      {offline && view.isScorerDevice && !view.locked && (
        <p className="rounded bg-yellow-100 p-2 text-base font-semibold">No signal: scores are kept on this phone and sent when it reconnects.</p>
      )}
      {queueState.dropped > 0 && (
        <p role="alert" className="rounded border-2 border-red-800 p-2 text-base font-semibold text-red-800">
          {queueState.dropped === 1 ? '1 score was' : `${queueState.dropped} scores were`} refused by the server and not saved. Check
          the card.
        </p>
      )}

      {view.locked && <p className="rounded border-4 border-slate-950 p-3 text-lg font-bold">Card is signed. Scores can no longer change.</p>}

      {!view.isScorerDevice && !view.locked && (
        <section aria-label="Scorer" className="space-y-2 rounded border-4 border-slate-950 p-3">
          {view.hasScorerDevice ? (
            <p className="text-lg font-semibold">
              {assignedName ? `${assignedName} is` : 'Another phone is'} keeping score. This card updates automatically.
            </p>
          ) : (
            <>
              <p className="text-lg font-semibold">
                {assignedName ? `${assignedName} keeps score for this group.` : 'Who is keeping score on this phone?'}
              </p>
              {!assignedName && (
                <select
                  value={claimFor}
                  onChange={(e) => setClaimFor(e.target.value)}
                  aria-label="Scorer"
                  className="min-h-[56px] w-full rounded border-2 border-slate-950 bg-white px-3 text-lg"
                >
                  <option value="">Choose a player</option>
                  {view.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={claim}
                disabled={!claimFor || claiming}
                className="min-h-[56px] w-full rounded bg-slate-950 text-lg font-bold text-white disabled:opacity-50"
              >
                {assignedName ? `I'm ${assignedName}: keep score on this phone` : 'Keep score on this phone'}
              </button>
            </>
          )}
          {claimError && (
            <p role="alert" className="text-lg font-semibold text-red-800">
              {claimError}
            </p>
          )}
        </section>
      )}

      <section aria-label={`Hole ${hole.number}`} className="space-y-3">
        <div className="flex items-baseline justify-between rounded bg-slate-950 px-4 py-3 text-white">
          <h2 className="text-4xl font-black">Hole {hole.number}</h2>
          <p className="text-xl font-bold">
            Par {hole.par} · SI {hole.strokeIndex}
          </p>
        </div>
        {hole.number > 18 && <p className="text-base font-semibold">Extra hole: played as hole {((hole.number - 1) % 18) + 1}.</p>}

        <ul className="space-y-3">
          {view.players.map((p) => {
            const gross = grid[p.id]?.[idx] ?? null;
            const { strokes, net: n } = netOnHole(gross, p.playingHandicap, hole, view.holes.length);
            const t = totals(p.id);
            return (
              <li key={p.id} className="rounded-lg border-2 border-slate-950 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xl font-bold">{p.name}</p>
                    <p className="text-sm font-semibold text-slate-700">
                      {net ? `HCP ${p.playingHandicap}${strokes ? ` · ${strokes > 0 ? '+' : ''}${strokes} here` : ''} · ` : ''}
                      {t.n ? `${t.gross}${net ? ` (net ${t.net})` : ''} thru ${t.n}` : 'No scores yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => bump(p.id, -1)}
                        aria-label={`${p.name} minus one`}
                        className={`${btn} border-4 border-slate-950 bg-white`}
                      >
                        −
                      </button>
                    )}
                    <div className="w-16 text-center">
                      <span aria-label={`${p.name} gross`} className="block text-5xl font-black tabular-nums">
                        {gross ?? '–'}
                      </span>
                      {net && n != null && <span className="text-sm font-bold">net {n}</span>}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => bump(p.id, 1)}
                        aria-label={`${p.name} plus one`}
                        className={`${btn} bg-slate-950 text-white`}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {match && (
          <p aria-live="polite" className="rounded bg-green-800 px-4 py-3 text-center text-2xl font-black text-white">
            {match.label}
          </p>
        )}
        {extraOffer && (
          <button type="button" onClick={addExtraHole} className={`${btn} w-full bg-green-800 text-xl text-white`}>
            Extra hole {extraOffer}
          </button>
        )}
      </section>

      <nav aria-label="Holes" className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => go(-1)} className={`${btn} border-4 border-slate-950 bg-white text-xl`}>
            ← Prev
          </button>
          <button type="button" onClick={() => go(1)} className={`${btn} bg-slate-950 text-xl text-white`}>
            Next →
          </button>
        </div>
        <details className="rounded border-2 border-slate-950">
          <summary className="flex min-h-[48px] cursor-pointer items-center px-3 text-lg font-bold">Go to hole</summary>
          <div className="grid grid-cols-6 gap-2 p-2">
            {slots.map((i) => {
              const h = holeAt(view.holes, i);
              const done = view.players.length > 0 && view.players.every((p) => grid[p.id]?.[i] != null);
              const current = i === idx;
              return (
                <button
                  key={h.number}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-current={current ? 'true' : undefined}
                  aria-label={`Hole ${h.number}${done ? ', scored' : ''}`}
                  className={`min-h-[48px] rounded text-lg font-bold ${
                    current ? 'bg-slate-950 text-white' : done ? 'border-2 border-green-800 bg-green-100' : 'border-2 border-slate-400 bg-white'
                  }`}
                >
                  {h.number}
                </button>
              );
            })}
          </div>
        </details>
      </nav>
    </div>
  );
}
