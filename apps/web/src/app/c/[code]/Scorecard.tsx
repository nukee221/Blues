'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { claimScorer, openGroup, saveScores, type GroupView } from '@/actions/scorecard';
import { createScoreQueue, type QueueState, type ScoreQueue } from '@/lib/scoreQueue';
import { liveMatch, netOnHole, playOrder } from '@/lib/scorecardView';

const FLUSH_MS = 15_000;
const POLL_MS = 10_000;
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

/** Server scores with this device's unsent entries on top. */
function withPending(view: GroupView, queue: ScoreQueue | null): Grid {
  const grid = copyGrid(view.scores);
  for (const e of queue?.entries() ?? []) {
    const i = view.holes.findIndex((h) => h.number === e.hole);
    if (i >= 0 && grid[e.playerId]) grid[e.playerId]![i] = e.gross;
  }
  return grid;
}

function firstOpenHole(view: GroupView, grid: Grid): number {
  const order = playOrder(view.holes, view.startHole);
  return order.find((i) => view.players.some((p) => grid[p.id]?.[i] == null)) ?? order[0] ?? 0;
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function Scorecard({ code, initial }: { code: string; initial: GroupView }) {
  const [view, setView] = useState(initial);
  const [grid, setGrid] = useState<Grid>(() => copyGrid(initial.scores));
  const [idx, setIdx] = useState(() => firstOpenHole(initial, initial.scores));
  const [queueState, setQueueState] = useState<QueueState>({ pending: 0, sending: false, error: null });
  const [claimFor, setClaimFor] = useState(initial.scorerPlayerId ?? '');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const queueRef = useRef<ScoreQueue | null>(null);
  const lastTs = useRef(0);

  const canEdit = view.isScorerDevice && !view.locked;
  const hole = view.holes[idx]!;
  const order = useMemo(() => playOrder(view.holes, view.startHole), [view.holes, view.startHole]);
  const pos = order.indexOf(idx);

  const refresh = useCallback(async () => {
    try {
      const next = await openGroup(code);
      setView(next);
      if (!next.isScorerDevice || next.locked) setGrid(copyGrid(next.scores));
      else setGrid(withPending(next, queueRef.current));
    } catch {
      // Offline: keep showing what we have.
    }
  }, [code]);

  // The queue lives in the browser; create it once per code.
  useEffect(() => {
    const q = createScoreQueue(browserStorage(), (entries) => saveScores(code, entries), {
      code,
      onChange: setQueueState,
    });
    queueRef.current = q;
    setQueueState({ pending: q.pending(), sending: false, error: null });
    // The server render could not set the device cookie; this call does, and folds in unsent entries.
    void refresh();
    return () => {
      queueRef.current = null;
    };
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

  // Everyone else polls (anonymous code holders cannot use realtime under RLS).
  useEffect(() => {
    if (canEdit) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canEdit, refresh]);

  // A save refused for good (card signed, scorer handed off): re-read who may edit.
  useEffect(() => {
    if (queueState.error === 'Card is signed' || queueState.error === 'Only the scorer can enter scores') void refresh();
  }, [queueState.error, refresh]);

  function bump(playerId: string, delta: 1 | -1) {
    if (!canEdit) return;
    const current = grid[playerId]?.[idx] ?? null;
    const gross = current == null ? hole.par : Math.min(15, Math.max(1, current + delta));
    if (gross === current) return;
    setGrid((g) => {
      const next = copyGrid(g);
      next[playerId]![idx] = gross;
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
      await claimScorer(code, claimFor);
      await refresh();
    } catch (e) {
      setClaimError(errorText(e, 'Could not claim the scorecard'));
    } finally {
      setClaiming(false);
    }
  }

  const go = (step: 1 | -1) => setIdx(order[(pos + step + order.length) % order.length]!);
  const match = view.kind === 'match' ? liveMatch(view, grid) : null;
  const net = view.handicapMode === 'net';
  const totals = (pid: string) => {
    let gross = 0;
    let nett = 0;
    let n = 0;
    view.holes.forEach((h, i) => {
      const g = grid[pid]?.[i];
      if (g == null) return;
      gross += g;
      nett += netOnHole(g, view.players.find((p) => p.id === pid)!.playingHandicap, h, view.holes.length).net!;
      n += 1;
    });
    return { gross, net: nett, n };
  };
  const assignedName = view.players.find((p) => p.id === view.scorerPlayerId)?.name;

  let status: string;
  if (view.locked) status = 'Card is signed';
  else if (!view.isScorerDevice) status = 'View only · updates every 10 s';
  else if (queueState.error && queueState.pending > 0 && typeof navigator !== 'undefined' && navigator.onLine) status = `Not saved: ${queueState.error} (${queueState.pending})`;
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
            {order.map((i) => {
              const h = view.holes[i]!;
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
