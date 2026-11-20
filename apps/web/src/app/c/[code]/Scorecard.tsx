'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { claimScorer, openGroup, saveScores, type GroupView } from '@/actions/scorecard';
import { unwrap } from '@/lib/actionResult';
import { SC } from '@/lib/scorecardCodes';
import { createScoreQueue, type QueueState, type ScoreQueue } from '@/lib/scoreQueue';
import { extraScored, holeAt, liveMatch, netOnHole, nextExtraHole, playOrder } from '@/lib/scorecardView';
import { cardCompletion } from '@/lib/cardCompletion';
import { formatHandicap } from '@/lib/handicapFormat';
import Sign, { SignedBanner } from './Sign';
import TakeOver from './TakeOver';
import { fillScores, isNewer, loadCachedView, loadGroupView, pickNewer, saveCachedView, updateCachedCell } from '@/lib/viewCache';

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
  return order.find((i) => view.players.some((p) => !p.withdrawn && grid[p.id]?.[i] == null)) ?? order[0] ?? 0;
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
  const viewRef = useRef(initial);

  const canEdit = view.isScorerDevice && !view.locked;
  const hole = holeAt(view.holes, idx);
  const extras = Math.max(extrasShown, extraScored(view.holes, grid));
  const slots = useMemo(
    () => [...playOrder(view.holes, view.startHole), ...Array.from({ length: extras }, (_, k) => view.holes.length + k)],
    [view.holes, view.startHole, extras],
  );
  const pos = Math.max(0, slots.indexOf(idx));

  /** Show `next` unless what is on screen is newer; never blank a score already shown. */
  const apply = useCallback((next: GroupView, startedAt: number) => {
    if (isNewer(viewRef.current, next)) return; // e.g. an old cached view while offline
    viewRef.current = next;
    setView(next);
    // A tap landed while this read was in flight: keep the local grid, take the rest.
    if (lastEditAt.current > startedAt && next.isScorerDevice && !next.locked) return;
    setGrid((prev) => {
      const merged = { ...next, scores: fillScores(next.scores, prev) };
      return next.isScorerDevice && !next.locked ? withPending(merged, queueRef.current) : copyGrid(merged.scores);
    });
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
    const q = createScoreQueue(storage, async (entries) => unwrap(await saveScores(code, entries)), {
      code,
      onChange: setQueueState,
    });
    queueRef.current = q;
    setQueueState((s) => ({ ...s, pending: q.pending() }));
    // Offline, `initial` is the stale render inside the service worker's cached HTML: start
    // from whichever of it and the cached view is newer, filling gaps from the other, with
    // this phone's unsent scores on top. The cache is only written if `initial` is newer.
    const cachedRaw = loadCachedView<GroupView>(storage, code);
    const cached = cachedRaw && cachedRaw.groupId === initial.groupId && cachedRaw.scores ? cachedRaw : null;
    saveCachedView(storage, code, initial);
    const base = pickNewer(initial, cached);
    const other = base === initial ? cached : initial;
    const merged = { ...base, scores: other ? fillScores(base.scores, other.scores) : base.scores };
    const start = merged.isScorerDevice && !merged.locked ? withPending(merged, q) : copyGrid(merged.scores);
    viewRef.current = base;
    setView(base);
    setGrid(start);
    if (base !== initial) setIdx(firstOpenHole(base, start));
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
    // Keep the cached view in step, so a reload with no signal still shows this score.
    if (storageRef.current) updateCachedCell(storageRef.current, code, playerId, idx, gross);
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
      <p role="alert" className="text-xl font-semibold text-brandred-500">
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
  const completion = cardCompletion({ ...view, scores: grid });
  const assignedName = view.players.find((p) => p.id === view.scorerPlayerId)?.name;
  // Scores this phone queued but can no longer send (scoring moved to another phone, or the card
  // was signed): never dropped silently. `queueState.pending` re-renders this when the queue changes.
  const unsent = !canEdit && queueState.pending >= 0 ? (queueRef.current?.entries() ?? []) : [];
  const scorerName = view.hasScorerDevice && !view.locked ? assignedName : undefined;

  let status: string;
  if (view.locked) status = 'Card is signed';
  else if (!view.isScorerDevice && queueState.pending > 0) status = `Not sent (${queueState.pending})${scorerName ? ` · scoring moved to ${scorerName}` : ''}`;
  else if (!view.isScorerDevice) status = offline ? 'Offline · view only' : 'View only · updates every 10 s';
  else if (queueState.pending > 0 && queueState.errorCode) status = `Not saved: ${queueState.error} (${queueState.pending})`;
  else if (queueState.pending > 0) status = `Waiting for signal (${queueState.pending})`;
  else status = 'Saved';
  const statusOk = status === 'Saved';

  const btn = 'flex min-h-[56px] min-w-[56px] items-center justify-center rounded-lg text-2xl font-bold';

  return (
    <div className="space-y-4 text-white">
      <header className="space-y-2">
        <div>
          <p className="eyebrow text-gold-400">
            Round {view.roundNumber} · {view.kind === 'match' ? 'Match play' : 'Stroke play'}
            {net ? ' · net' : ' · gross'}
          </p>
          <h1 className="display mt-1 text-3xl">{view.eventName}</h1>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`inline-block rounded px-2 py-1 text-sm font-bold ${
            statusOk ? 'bg-gold-400 text-navy-950' : view.isScorerDevice && !view.locked ? (queueState.errorCode ? 'bg-brandred-600 text-white' : 'bg-white text-navy-950') : 'bg-navy-800 text-silver-300'
          }`}
        >
          {status}
        </p>
      </header>

      {offline && view.isScorerDevice && !view.locked && (
        <p className="rounded-lg border-2 border-gold-400 bg-navy-800 p-2 text-base font-semibold">No signal: scores are kept on this phone and sent when it reconnects.</p>
      )}
      {queueState.dropped > 0 && (
        <p role="alert" className="rounded-lg border-2 border-brandred-500 bg-brandred-700/30 p-2 text-base font-semibold text-white">
          {queueState.dropped === 1 ? '1 score was' : `${queueState.dropped} scores were`} refused by the server and not saved. Check
          the card.
        </p>
      )}

      {view.locked && <SignedBanner view={view} />}
      {!view.locked && completion.complete && (
        <Sign code={code} view={view} pending={view.isScorerDevice ? queueState.pending : 0} onSigned={refresh} />
      )}

      {!view.isScorerDevice && !view.locked && (
        <section aria-label="Scorer" className="card-dark space-y-2 border-2 border-gold-400/70 p-3">
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
                  className="min-h-[56px] w-full rounded-lg border-2 border-white/30 bg-navy-900 text-white focus:border-gold-400 focus:outline-none px-3 text-lg"
                >
                  <option value="">Choose a player</option>
                  {view.players.filter((p) => !p.withdrawn).map((p) => (
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
                className="btn-red w-full min-h-[56px] disabled:opacity-50"
              >
                {assignedName ? `I'm ${assignedName}: keep score on this phone` : 'Keep score on this phone'}
              </button>
            </>
          )}
          {claimError && (
            <p role="alert" className="text-lg font-semibold text-brandred-500">
              {claimError}
            </p>
          )}
          <TakeOver code={code} view={view} onDone={refresh} />
        </section>
      )}

      {unsent.length > 0 && (
        <section aria-label="Not sent" role="alert" className="space-y-2 rounded-xl border-4 border-brandred-500 bg-navy-800 p-3">
          <h2 className="display text-2xl text-brandred-500">
            Not sent ({unsent.length}){scorerName ? ` — scoring moved to ${scorerName}` : ''}
          </h2>
          <p className="text-base font-semibold">
            These scores were entered on this phone but never reached the card. Check them against the card and re-enter any that are
            missing on {scorerName ? `${scorerName}'s` : 'the scorer'} phone.
          </p>
          <ul className="space-y-1 text-lg font-semibold">
            {unsent.map((e) => (
              <li key={`${e.playerId}:${e.hole}`}>
                {view.players.find((p) => p.id === e.playerId)?.name ?? 'Player'} · hole {e.hole}: {e.gross}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => queueRef.current?.clear()}
            className="min-h-[48px] w-full rounded-lg border-2 border-white/40 bg-transparent text-white text-lg font-bold"
          >
            I have re-entered these
          </button>
        </section>
      )}

      <section aria-label={`Hole ${hole.number}`} className="space-y-3">
        <div className="flex items-baseline justify-between rounded-xl border-b-4 border-gold-400 bg-navy-950 px-4 py-3 text-white">
          <h2 className="display text-5xl">
            Hole <span className="text-gold-grad">{hole.number}</span>
          </h2>
          <p className="font-label text-xl font-semibold uppercase tracking-wider text-silver-300">
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
              <li key={p.id} className="row-card p-3">
                <div className={canEdit ? 'space-y-2' : 'flex items-center justify-between gap-2'}>
                  <div className="min-w-0">
                    <p className="truncate text-xl font-bold">
                      {p.name}
                      {p.withdrawn && <span className="ml-2 rounded bg-silver-400 px-1.5 text-base text-navy-950">WD</span>}
                    </p>
                    <p className="text-sm font-semibold text-silver-300">
                      {net ? `HCP ${formatHandicap(p.playingHandicap)}${strokes ? ` · ${strokes > 0 ? '+' : ''}${strokes} here` : ''} · ` : ''}
                      {t.n ? `${t.gross}${net ? ` (net ${t.net})` : ''} thru ${t.n}` : 'No scores yet'}
                    </p>
                  </div>
                  <div className={`flex items-center gap-3 ${canEdit ? 'justify-between' : 'justify-end'}`}>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => bump(p.id, -1)}
                        aria-label={`${p.name} minus one`}
                        className={`${btn} border-2 border-white/50 bg-transparent text-white`}
                      >
                        −
                      </button>
                    )}
                    <div className="w-16 text-center">
                      <span aria-label={`${p.name} gross`} className="block text-5xl font-black tabular-nums">
                        {gross ?? '–'}
                      </span>
                      {net && n != null && <span className="text-sm font-bold text-gold-400">net {n}</span>}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => bump(p.id, 1)}
                        aria-label={`${p.name} plus one`}
                        className={`${btn} bg-gold-400 text-navy-950`}
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
          <p aria-live="polite" className="display rounded-xl bg-gold-400 px-4 py-3 text-center text-3xl text-navy-950">
            {match.label}
          </p>
        )}
        {extraOffer && (
          <button type="button" onClick={addExtraHole} className="btn-red w-full min-h-[56px] text-xl">
            Extra hole {extraOffer}
          </button>
        )}
      </section>

      <nav aria-label="Holes" className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => go(-1)} className={`${btn} border-2 border-white/50 bg-transparent font-label text-xl uppercase tracking-wider text-white`}>
            ← Prev
          </button>
          <button type="button" onClick={() => go(1)} className={`${btn} bg-gold-400 font-label text-xl uppercase tracking-wider text-navy-950`}>
            Next →
          </button>
        </div>
        <details className="rounded-xl border-2 border-white/20 bg-navy-800/80">
          <summary className="eyebrow flex min-h-[48px] cursor-pointer items-center px-3 text-silver-300">Go to hole</summary>
          <div className="grid grid-cols-6 gap-2 p-2">
            {slots.map((i) => {
              const h = holeAt(view.holes, i);
              const active = view.players.filter((p) => !p.withdrawn);
              const done = active.length > 0 && active.every((p) => grid[p.id]?.[i] != null);
              const current = i === idx;
              return (
                <button
                  key={h.number}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-current={current ? 'true' : undefined}
                  aria-label={`Hole ${h.number}${done ? ', scored' : ''}`}
                  className={`min-h-[48px] rounded text-lg font-bold ${
                    current ? 'bg-gold-400 text-navy-950' : done ? 'border-2 border-gold-400/70 bg-navy-600 text-white' : 'border-2 border-white/20 text-silver-300'
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
