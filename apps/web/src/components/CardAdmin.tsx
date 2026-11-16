'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { HoleInfo } from '@hgt/scoring';
import { adminEditScore, adminSignCard, reopenCard, setGroupPlayerWithdrawn } from '@/actions/signing';
import type { ActionResult } from '@/lib/actionResult';
import { cardCompletion } from '@/lib/cardCompletion';
import { holeAt, liveMatch } from '@/lib/scorecardView';
import type { CardSignature } from '@/lib/cardData';
import type { SignRole } from '@/lib/signingCodes';
import { formatCentral } from '@/lib/time';

type Props = {
  groupId: string;
  locked: boolean;
  signedAt: string | null;
  scorerPlayerId: string | null;
  kind: 'stroke' | 'match';
  players: { id: string; name: string; playingHandicap: number; withdrawn?: boolean }[];
  holes: HoleInfo[];
  scores: Record<string, (number | null)[]>;
  signatures: CardSignature[];
  startHole: number;
  matchStrokes: 'full' | 'offLow';
};

const btn = 'min-h-[44px] rounded px-4 font-semibold disabled:opacity-50';
const field = 'block min-h-[44px] w-full rounded border px-2 text-base';

/** Commissioner card tools: scores grid, signatures, edit a score, sign on behalf, reopen. */
export default function CardAdmin(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState({ playerId: p.players[0]?.id ?? '', hole: p.holes[0]?.number ?? 1, gross: '' });
  const [behalf, setBehalf] = useState<{ playerId: string; role: SignRole }>({ playerId: p.scorerPlayerId ?? '', role: 'scorer' });
  const [reason, setReason] = useState('');

  const slots = Math.max(p.holes.length, ...Object.values(p.scores).map((r) => r.length));
  const columns = Array.from({ length: slots }, (_, i) => holeAt(p.holes, i));
  const holeOptions = p.kind === 'match' ? [...columns, holeAt(p.holes, slots)] : columns;
  const completion = cardCompletion({ ...p });
  const match = p.kind === 'match' ? liveMatch(p, p.scores) : null;

  function run(label: string, action: () => Promise<ActionResult<unknown>>, after?: () => void) {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const r = await action();
        if (r.ok) {
          setNotice(label);
          after?.();
          router.refresh();
        } else setError(r.error);
      } catch {
        setError('Could not reach the server. Try again.');
      }
    });
  }

  const sig = (role: SignRole) => p.signatures.find((s) => s.role === role);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Status</h2>
        <p className={`rounded p-2 font-semibold ${p.locked ? 'bg-slate-900 text-white' : 'bg-yellow-100'}`}>
          {p.locked ? `Signed and locked${p.signedAt ? ` · ${formatCentral(p.signedAt)}` : ''}` : completion.complete ? 'Complete, waiting for signatures' : `Not complete: ${completion.message}`}
        </p>
        {p.kind === 'match' && p.players.length !== 2 && (
          <p role="alert" className="rounded border-2 border-red-700 p-2 font-semibold text-red-800">
            This match group has {p.players.length} player{p.players.length === 1 ? '' : 's'}. A match card needs exactly two players
            to be signed: fix the group in the tee sheet first.
          </p>
        )}
        {match && <p className="font-semibold">{match.label}</p>}
        <ul>
          {(['scorer', 'attest'] as const).map((role) => (
            <li key={role}>
              {role === 'scorer' ? 'Scorer' : 'Attest'}: {sig(role) ? `${sig(role)!.name} · ${formatCentral(sig(role)!.signedAt)}` : 'not signed'}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Scores</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-center text-sm">
            <thead>
              <tr>
                <th className="border px-2 py-1 text-left">Hole</th>
                {columns.map((h) => (
                  <th key={h.number} className="border px-2 py-1">
                    {h.number}
                  </th>
                ))}
                <th className="border px-2 py-1">Tot</th>
              </tr>
            </thead>
            <tbody>
              {p.players.map((pl) => {
                const row = p.scores[pl.id] ?? [];
                const total = row.slice(0, p.holes.length).reduce<number>((t, g) => t + (g ?? 0), 0);
                return (
                  <tr key={pl.id}>
                    <th className="border px-2 py-1 text-left whitespace-nowrap">
                      {pl.name}
                      {pl.withdrawn && <span className="ml-1 rounded bg-gray-700 px-1 text-xs text-white">WD</span>}
                    </th>
                    {columns.map((h, i) => (
                      <td key={h.number} className="border px-2 py-1 tabular-nums">
                        <button
                          type="button"
                          className="min-h-[44px] min-w-[44px]"
                          aria-label={`Edit ${pl.name} hole ${h.number}`}
                          onClick={() => setEdit({ playerId: pl.id, hole: h.number, gross: row[i] != null ? String(row[i]) : '' })}
                        >
                          {row[i] ?? '–'}
                        </button>
                      </td>
                    ))}
                    <td className="border px-2 py-1 font-bold tabular-nums">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {p.kind === 'stroke' && !p.locked && (
        <section className="space-y-2 rounded border p-3">
          <h2 className="text-lg font-semibold">Withdrawals</h2>
          <p className="text-sm text-gray-700">
            A withdrawn (WD) player is left out of the card&rsquo;s completeness and the play-in cut, and cannot keep score or sign.
            Changing this clears the card&rsquo;s signatures.
          </p>
          <ul className="space-y-2">
            {p.players.map((pl) => (
              <li key={pl.id} className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {pl.name}
                  {pl.withdrawn ? ' · WD' : ''}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={!!pl.withdrawn}
                  onClick={() =>
                    run(pl.withdrawn ? `${pl.name} reinstated` : `${pl.name} marked WD`, () => setGroupPlayerWithdrawn(p.groupId, pl.id, !pl.withdrawn))
                  }
                  className={`${btn} border ${pl.withdrawn ? 'border-green-700 text-green-800' : 'border-red-700 text-red-800'}`}
                >
                  {pl.withdrawn ? 'Undo WD' : 'Mark WD'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2 rounded border p-3">
        <h2 className="text-lg font-semibold">Edit a score</h2>
        {p.locked && <p className="text-sm text-gray-700">The card stays signed; the change is recorded in the history.</p>}
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">
            Player
            <select value={edit.playerId} onChange={(e) => setEdit({ ...edit, playerId: e.target.value })} className={field}>
              {p.players.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Hole
            <select value={edit.hole} onChange={(e) => setEdit({ ...edit, hole: Number(e.target.value) })} className={field}>
              {holeOptions.map((h) => (
                <option key={h.number} value={h.number}>
                  {h.number}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Gross
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={15}
              value={edit.gross}
              onChange={(e) => setEdit({ ...edit, gross: e.target.value })}
              className={field}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={pending || !edit.playerId || edit.gross === ''}
          onClick={() => run('Score saved', () => adminEditScore(p.groupId, edit.playerId, edit.hole, Number(edit.gross)))}
          className={`${btn} bg-green-700 text-white`}
        >
          Save score
        </button>
      </section>

      {!p.locked && (
        <section className="space-y-2 rounded border p-3">
          <h2 className="text-lg font-semibold">Sign on behalf</h2>
          <p className="text-sm text-gray-700">For a player who cannot sign with a PIN. Recorded in the history.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Player
              <select value={behalf.playerId} onChange={(e) => setBehalf({ ...behalf, playerId: e.target.value })} className={field}>
                <option value="">Choose</option>
                {p.players.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Role
              <select value={behalf.role} onChange={(e) => setBehalf({ ...behalf, role: e.target.value as SignRole })} className={field}>
                <option value="scorer">Scorer</option>
                <option value="attest">Attest</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={pending || !behalf.playerId}
            onClick={() => run('Signed', () => adminSignCard(p.groupId, behalf.playerId, behalf.role))}
            className={`${btn} border border-green-700 text-green-800`}
          >
            Sign for player
          </button>
        </section>
      )}

      {(p.locked || p.signatures.length > 0) && (
        <section className="space-y-2 rounded border border-red-700 p-3">
          <h2 className="text-lg font-semibold">Reopen card</h2>
          <p className="text-sm text-gray-700">Unlocks the card and clears both signatures. The players sign again.</p>
          <label className="block text-sm">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} maxLength={500} />
          </label>
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run('Card reopened', () => reopenCard(p.groupId, reason), () => setReason(''))}
            className={`${btn} bg-red-700 text-white`}
          >
            Reopen
          </button>
        </section>
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
