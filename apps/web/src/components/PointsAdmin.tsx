'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pointsTable } from '@hgt/scoring';
import { clearOverride, finalizeEvent, overridePoints, saveEventTypePoints } from '@/actions/points';
import type { ActionResult } from '@/lib/actionResult';
import type { EventType } from '@/lib/eventStatus';
import { formatPoints } from '@/lib/standings';

export type TableValue = { eventType: EventType; label: string; winnerPoints: number; values: number[]; stored: boolean };
export type AwardValue = { playerId: string; name: string; points: number; override: boolean };
export type EventValue = { id: string; name: string; eventType: string; status: string; awards: AwardValue[] };

const btn = 'min-h-[44px] rounded px-4 font-semibold disabled:opacity-50';
const field = 'block min-h-[44px] w-full rounded border px-2 text-base';

type Run = (label: string, action: () => Promise<ActionResult<unknown>>) => void;

/** Commissioner points tools for one season: tables per event type, finalize / recalculate, overrides. */
export default function PointsAdmin({ seasonId, tables, events, roster }: { seasonId: string; tables: TableValue[]; events: EventValue[]; roster: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run: Run = (label, action) => {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const r = await action();
        if (r.ok) {
          setNotice(label);
          router.refresh();
        } else setError(r.error);
      } catch {
        setError('Could not reach the server. Try again.');
      }
    });
  };

  return (
    <div className="space-y-6">
      <div aria-live="polite">
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {notice && <p role="status" className="text-green-800">{notice}</p>}
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Events</h2>
        {events.length === 0 && <p className="text-gray-700">No events in this season yet.</p>}
        {events.map((e) => (
          <EventPoints key={e.id} ev={e} roster={roster} pending={pending} run={run} />
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Points tables</h2>
        <p className="text-sm text-gray-700">Values are points by finishing place, 1st first. Saving a table does not change final events until you recalculate them.</p>
        {tables.map((t) => (
          <TableEditor key={t.eventType} t={t} pending={pending} run={run} seasonId={seasonId} />
        ))}
      </section>
    </div>
  );
}

function TableEditor({ t, pending, run, seasonId }: { t: TableValue; pending: boolean; run: Run; seasonId: string }) {
  const [winner, setWinner] = useState(String(t.winnerPoints));
  const [values, setValues] = useState(t.values.join(', '));
  const [local, setLocal] = useState<string | null>(null);
  const parsed = values.split(/[\s,]+/).filter(Boolean).map(Number);
  return (
    <form
      className="space-y-2 rounded border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const w = Number(winner);
        if (!Number.isFinite(w) || parsed.some((v) => !Number.isFinite(v))) {
          setLocal('Enter numbers only');
          return;
        }
        setLocal(null);
        run(`${t.label} table saved`, () => saveEventTypePoints(seasonId, t.eventType, w, parsed));
      }}
    >
      <h3 className="font-semibold">
        {t.label}
        {!t.stored && <span className="ml-2 text-sm font-normal text-gray-600">(not set: the default 500 table is used)</span>}
      </h3>
      <label className="block text-sm">
        Winner points
        <input inputMode="decimal" value={winner} onChange={(e) => setWinner(e.target.value)} className={field} />
      </label>
      <label className="block text-sm">
        Table ({parsed.length} places)
        <textarea value={values} onChange={(e) => setValues(e.target.value)} rows={3} className={`${field} py-2`} />
      </label>
      {local && <p role="alert" className="text-sm text-red-700">{local}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={`${btn} bg-green-700 text-white`}>
          Save table
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const w = Number(winner);
            if (Number.isFinite(w) && w > 0) setValues(pointsTable(w).join(', '));
          }}
          className={`${btn} border`}
        >
          Scale default to winner points
        </button>
      </div>
    </form>
  );
}

function EventPoints({ ev, roster, pending, run }: { ev: EventValue; roster: { id: string; name: string }[]; pending: boolean; run: Run }) {
  const [who, setWho] = useState('');
  const [pts, setPts] = useState('');
  const sorted = [...ev.awards].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const canFinalize = ev.status === 'in_progress' || ev.status === 'final';
  return (
    <div className="space-y-2 rounded border p-3">
      <h3 className="font-semibold">{ev.name}</h3>
      <p className="text-sm text-gray-700">
        {ev.status.replace('_', ' ')} · {ev.eventType.replace('_', ' ')} · {ev.awards.length} award{ev.awards.length === 1 ? '' : 's'}
      </p>
      {canFinalize && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (ev.status === 'final' || window.confirm(`Finalize ${ev.name}? Points are awarded and the event becomes final.`)) {
              run(ev.status === 'final' ? 'Points recalculated' : 'Event finalized', () => finalizeEvent(ev.id));
            }
          }}
          className={`${btn} ${ev.status === 'final' ? 'border border-green-700 text-green-800' : 'bg-green-700 text-white'}`}
        >
          {ev.status === 'final' ? 'Recalculate' : 'Finalize'}
        </button>
      )}
      {sorted.length > 0 && (
        <ul className="divide-y rounded border">
          {sorted.map((a) => (
            <li key={a.playerId} className="flex min-h-[44px] items-center justify-between gap-2 px-2">
              <span>
                {a.name}
                {a.override && <span className="ml-2 rounded bg-amber-600 px-1.5 text-xs font-semibold text-white">Override</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-bold tabular-nums">{formatPoints(a.points)}</span>
                {a.override && (
                  <button type="button" disabled={pending} onClick={() => run('Override cleared', () => clearOverride(ev.id, a.playerId))} className={`${btn} border px-3 text-sm`}>
                    Clear
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(pts);
          if (!who || pts.trim() === '' || !Number.isFinite(n)) return;
          run('Points overridden', () => overridePoints(ev.id, who, n));
        }}
      >
        <label className="flex-1 text-sm">
          Override: player
          <select value={who} onChange={(e) => setWho(e.target.value)} className={field}>
            <option value="">Choose</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="w-28 text-sm">
          Points
          <input inputMode="decimal" value={pts} onChange={(e) => setPts(e.target.value)} className={field} />
        </label>
        <button type="submit" disabled={pending || !who || pts.trim() === ''} className={`${btn} bg-amber-600 text-white`}>
          Set
        </button>
      </form>
    </div>
  );
}
