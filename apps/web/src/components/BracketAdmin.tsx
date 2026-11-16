'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { awardForfeit, closePlayIn, drawEventBracket, finalizeMatch, setRoundDeadline, type BracketView, type MatchView } from '@/actions/bracket';
import type { ActionResult } from '@/lib/actionResult';
import { roundName } from '@/lib/bracketView';
import { formatCentral, isoToCentralInput } from '@/lib/time';

const btn = 'min-h-[44px] rounded px-4 font-semibold disabled:opacity-50';
const field = 'block min-h-[44px] w-full rounded border px-2 text-base';

/** Commissioner bracket tools: close the play-in (tiebreak picker), draw, deadlines, forfeits. */
export default function BracketAdmin({ view }: { view: BracketView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tiebreak, setTiebreak] = useState<{ spots: number; playerIds: string[] } | null>(null);
  const [picks, setPicks] = useState<string[]>([]);

  function run<T>(label: string, action: () => Promise<ActionResult<T>>, after?: (data: T) => boolean | void) {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const r = await action();
        if (r.ok) {
          if (after?.(r.data) === false) return;
          setNotice(label);
          router.refresh();
        } else setError(r.error);
      } catch {
        setError('Could not reach the server. Try again.');
      }
    });
  }

  function close(winners?: string[]) {
    run('Play-in closed', () => closePlayIn(view.eventId, winners), (d) => {
      if ('needsTiebreak' in d) {
        setTiebreak(d.needsTiebreak);
        setPicks([]);
        setNotice(`Tie for the last ${d.needsTiebreak.spots === 1 ? 'spot' : `${d.needsTiebreak.spots} spots`}: pick who advances.`);
        return false;
      }
      setTiebreak(null);
    });
  }

  const name = (id: string) => view.names[id] ?? 'Player';
  const rounds = Array.from({ length: view.rounds }, (_, i) => i + 1);
  const flagged = view.matches.filter((m) => m.pastDeadline).length;

  return (
    <div className="space-y-6">
      {!view.closed && (
        <section className="space-y-2 rounded border p-3">
          <h2 className="text-lg font-semibold">1. Close the play-in</h2>
          <p className="text-sm text-gray-700">Every play-in card must be signed (withdrawn players excepted). The top players advance.</p>
          {!tiebreak ? (
            <button type="button" disabled={pending} onClick={() => close()} className={`${btn} bg-green-700 text-white`}>
              Close play-in
            </button>
          ) : (
            <fieldset className="space-y-2">
              <legend className="font-semibold">
                Tiebreak: choose {tiebreak.spots} of {tiebreak.playerIds.length}
              </legend>
              {tiebreak.playerIds.map((id) => (
                <label key={id} className="flex min-h-[44px] items-center gap-3 rounded border px-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={picks.includes(id)}
                    onChange={(e) => setPicks(e.target.checked ? [...picks, id] : picks.filter((p) => p !== id))}
                  />
                  {name(id)}
                </label>
              ))}
              <button type="button" disabled={pending || picks.length !== tiebreak.spots} onClick={() => close(picks)} className={`${btn} bg-green-700 text-white`}>
                Advance selected
              </button>
            </fieldset>
          )}
        </section>
      )}

      {view.closed && (
        <section className="space-y-2 rounded border p-3">
          <h2 className="text-lg font-semibold">Advanced ({view.advanced.length})</h2>
          <ul className="flex flex-wrap gap-2">
            {view.advanced.map((p) => (
              <li key={p.id} className="rounded bg-gray-100 px-2 py-1">
                {p.name}
              </li>
            ))}
          </ul>
          {!view.drawn && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm('Draw the bracket now? The draw is random and cannot be redone.')) run('Bracket drawn', () => drawEventBracket(view.eventId));
              }}
              className={`${btn} bg-green-700 text-white`}
            >
              Draw bracket
            </button>
          )}
        </section>
      )}

      {view.drawn && (
        <>
          {flagged > 0 && (
            <p role="alert" className="rounded border-2 border-red-700 p-2 font-semibold text-red-800">
              {flagged} match{flagged === 1 ? '' : 'es'} past the deadline
            </p>
          )}
          {rounds.map((r) => (
            <RoundAdmin key={r} view={view} round={r} pending={pending} run={run} />
          ))}
        </>
      )}

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-green-800">
          {notice}
        </p>
      )}
    </div>
  );
}

type Run = <T>(label: string, action: () => Promise<ActionResult<T>>, after?: (data: T) => boolean | void) => void;

function RoundAdmin({ view, round, pending, run }: { view: BracketView; round: number; pending: boolean; run: Run }) {
  const ms = view.matches.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot);
  const current = ms.find((m) => m.deadline)?.deadline ?? null;
  const [deadline, setDeadline] = useState(current ? isoToCentralInput(current) : '');
  return (
    <section className="space-y-3 rounded border p-3">
      <h2 className="text-lg font-semibold">{roundName(round, view.rounds)}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Deadline (Central)
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={field} />
        </label>
        <button
          type="button"
          disabled={pending || !deadline}
          onClick={() => run('Deadline saved', () => setRoundDeadline(view.eventId, round, deadline))}
          className={`${btn} bg-green-700 text-white`}
        >
          Save deadline
        </button>
        {current && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('Deadline cleared', () => setRoundDeadline(view.eventId, round, null), () => void setDeadline(''))}
            className={`${btn} border`}
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-sm text-gray-700">{current ? `Play by ${formatCentral(current)}` : 'No deadline'}</p>
      <ul className="space-y-2">
        {ms.map((m) => (
          <MatchAdmin key={m.key} view={view} m={m} pending={pending} run={run} />
        ))}
      </ul>
    </section>
  );
}

function MatchAdmin({ view, m, pending, run }: { view: BracketView; m: MatchView; pending: boolean; run: Run }) {
  const [winner, setWinner] = useState('');
  const open = !m.winnerId && !m.isBye && !!m.a && !!m.b;
  return (
    <li className={`space-y-2 rounded border-2 p-2 ${m.pastDeadline ? 'border-red-700' : 'border-gray-300'}`}>
      <p className="font-semibold">
        {m.key}: {m.a?.name ?? 'TBD'} vs {m.isBye ? 'bye' : m.b?.name ?? 'TBD'}
      </p>
      <p className="text-sm">
        {m.status}
        {m.winnerId ? ` · winner ${view.names[m.winnerId] ?? 'Player'}` : ''}
        {m.pastDeadline && <span className="ml-2 rounded bg-red-700 px-1.5 text-xs font-semibold text-white">Past deadline</span>}
      </p>
      {m.groupId && (
        <p className="text-sm">
          {m.code && (
            <>
              Code <strong className="tracking-widest">{m.code}</strong> ·{' '}
            </>
          )}
          <Link href={`/admin/cards/${m.groupId}`} className="inline-flex min-h-[44px] items-center font-semibold text-green-800 underline">
            Card admin
          </Link>
        </p>
      )}
      {open && m.cardLocked && (
        <button type="button" disabled={pending} onClick={() => run('Result recorded', () => finalizeMatch(view.eventId, m.key))} className={`${btn} border border-green-700 text-green-800`}>
          Record result from card
        </button>
      )}
      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Forfeit: winner
            <select value={winner} onChange={(e) => setWinner(e.target.value)} className={field}>
              <option value="">Choose</option>
              <option value={m.a!.id}>{m.a!.name}</option>
              <option value={m.b!.id}>{m.b!.name}</option>
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !winner}
            onClick={() => {
              if (window.confirm(`Award ${m.key} to ${view.names[winner] ?? 'this player'} by forfeit?`)) run('Forfeit awarded', () => awardForfeit(view.eventId, m.key, winner));
            }}
            className={`${btn} bg-red-700 text-white`}
          >
            Award forfeit
          </button>
        </div>
      )}
    </li>
  );
}
