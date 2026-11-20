'use client';
import { useEffect, useRef, useState } from 'react';
import { createMatchCard, getBracketView, type BracketView, type MatchView } from '@/actions/bracket';
import { roundName } from '@/lib/bracketView';
import { formatCentral } from '@/lib/time';

const POLL_MS = 20_000;
type Tee = { id: string; label: string };

/** The bracket, refreshed every 20 s (live match status). Rounds stack on mobile, columns from md up. */
export default function BracketLive({ eventId, initial, tees }: { eventId: string; initial: BracketView; tees: Tee[] }) {
  const [view, setView] = useState(initial);
  const [stale, setStale] = useState(false);
  const inflight = useRef(false);

  async function refresh() {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await getBracketView(eventId);
      if (r.ok) {
        setView(r.data);
        setStale(false);
      } else setStale(true);
    } catch {
      setStale(true);
    } finally {
      inflight.current = false;
    }
  }

  useEffect(() => {
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [eventId]);

  if (!view.drawn) {
    return (
      <p className="card-dark p-4 text-silver-300">
        {view.closed ? 'The play-in is closed. The bracket will be drawn soon.' : 'The bracket is drawn once the stroke-play play-in is complete.'}
      </p>
    );
  }
  const rounds = Array.from({ length: view.rounds }, (_, i) => i + 1);
  return (
    <div className="space-y-2">
      <p className="text-sm text-silver-300">Updates every 20 seconds · times are Central{stale ? ' · connection lost, retrying' : ''}</p>
      <div className="flex flex-col gap-6 md:grid md:auto-cols-fr md:grid-flow-col">
        {rounds.map((r) => {
          const ms = view.matches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
          const deadline = ms.find((m) => m.deadline)?.deadline ?? null;
          return (
            <section key={r} aria-label={roundName(r, view.rounds)} className="space-y-3">
              <h3 className="display text-2xl text-white">{roundName(r, view.rounds)}</h3>
              <p className="eyebrow text-silver-400">{deadline ? `Play by ${formatCentral(deadline)}` : 'No deadline set'}</p>
              {ms.map((m) => (
                <MatchCard key={m.key} eventId={eventId} m={m} me={view.me} tees={tees} defaultTee={view.playInTeeId} onChange={refresh} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PlayerLine({ p, winner }: { p: MatchView['a']; winner: string | null }) {
  const won = !!p && p.id === winner;
  return (
    <p className={`flex min-h-[44px] items-center justify-between px-3 ${won ? 'font-bold text-white' : p ? 'text-silver-300' : 'italic text-silver-400'}`}>
      <span>{p?.name ?? 'TBD'}</span>
      {won && <span className="rounded bg-gold-400 px-1.5 font-label text-xs font-bold uppercase tracking-wider text-navy-950">Won</span>}
    </p>
  );
}

function MatchCard({ eventId, m, me, tees, defaultTee, onChange }: { eventId: string; m: MatchView; me: string; tees: Tee[]; defaultTee: string | null; onChange: () => Promise<void> }) {
  const tone =
    m.kind === 'live' ? 'bg-brandred-600 text-white' : m.kind === 'final' || m.kind === 'forfeit' ? 'bg-navy-950 text-gold-400' : 'bg-navy-950 text-silver-300';
  return (
    <article className={`row-card overflow-hidden ${m.mine ? 'ring-2 ring-gold-400' : ''}`} aria-label={`Match ${m.key}`}>
      <PlayerLine p={m.a} winner={m.winnerId} />
      <div className="border-t border-white/10" />
      <PlayerLine p={m.isBye ? null : m.b} winner={m.winnerId} />
      <p className={`px-3 py-2 font-label text-sm font-semibold uppercase tracking-wider ${tone}`} data-testid="match-status">
        {m.status}
      </p>
      {m.mine && m.code && (
        <p className="px-3 py-2 text-sm text-silver-300">
          Card code <strong className="tracking-widest text-white">{m.code}</strong> ·{' '}
          <a className="inline-flex min-h-[44px] items-center font-semibold text-gold-400 underline" href={`/c/${m.code}`}>
            Open scorecard
          </a>
        </p>
      )}
      {m.mine && m.kind === 'not_scheduled' && m.a && m.b && <StartMatchCard eventId={eventId} matchKey={m.key} tees={tees} defaultTee={defaultTee} onDone={onChange} me={me} />}
    </article>
  );
}

function StartMatchCard({ eventId, matchKey, tees, defaultTee, onDone }: { eventId: string; matchKey: string; tees: Tee[]; defaultTee: string | null; onDone: () => Promise<void>; me: string }) {
  const [open, setOpen] = useState(false);
  const [teeId, setTeeId] = useState(defaultTee ?? tees[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const field = 'mt-1 block min-h-[44px] w-full rounded-lg border-2 border-white/20 bg-navy-900 px-2 text-base text-white focus:border-gold-400 focus:outline-none';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createMatchCard(eventId, matchKey, teeId || null, date || null);
      if (r.ok) {
        setCode(r.data.code);
        await onDone();
      } else setError(r.error);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <p className="px-3 py-2 text-sm text-silver-300" role="status">
        Card created. Code <strong className="tracking-widest text-white">{code}</strong> ·{' '}
        <a className="inline-flex min-h-[44px] items-center font-semibold text-gold-400 underline" href={`/c/${code}`}>
          Open scorecard
        </a>
      </p>
    );
  }
  if (!open) {
    return (
      <div className="p-3">
        <button type="button" onClick={() => setOpen(true)} className="btn-red w-full">
          Start match card
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-2 p-3">
      <label className="eyebrow block text-silver-300">
        Course and tee
        <select value={teeId} onChange={(e) => setTeeId(e.target.value)} className={field}>
          {tees.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="eyebrow block text-silver-300">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </label>
      <button type="submit" disabled={busy || !teeId} className="btn-red w-full disabled:opacity-50">
        {busy ? 'Creating…' : 'Create card and email both players'}
      </button>
      {error && (
        <p role="alert" className="text-brandred-500">
          {error}
        </p>
      )}
    </form>
  );
}
