'use client';
import { useState } from 'react';
import type { GroupView } from '@/actions/scorecard';
import { signCard } from '@/actions/signing';
import { SG, type SignRole } from '@/lib/signingCodes';
import { formatCentral } from '@/lib/time';

const ROLE_LABEL: Record<SignRole, string> = { scorer: 'Scorer', attest: 'Attest' };

/** "Card signed" with both names, shown on a locked card. */
export function SignedBanner({ view }: { view: GroupView }) {
  const sigs = view.signatures ?? [];
  const who = (role: SignRole) => sigs.find((s) => s.role === role);
  const last = sigs.map((s) => s.signedAt).sort().at(-1);
  return (
    <section aria-label="Card signed" className="space-y-1 rounded border-4 border-slate-950 p-3">
      <h2 className="text-xl font-black">Card signed</h2>
      <p className="text-lg font-semibold">Scorer: {who('scorer')?.name ?? 'commissioner'}</p>
      <p className="text-lg font-semibold">Attested: {who('attest')?.name ?? 'commissioner'}</p>
      {last && <p className="text-sm font-semibold text-slate-700">{formatCentral(last)}</p>}
      <p className="text-base">Scores can no longer change. The commissioner can reopen the card.</p>
    </section>
  );
}

/**
 * Two-person signing on a complete card: pick your name, enter your 4-digit PIN.
 * Works on any phone holding the code. `pending` (unsent scores on this phone)
 * blocks signing until they are saved.
 */
export default function Sign({
  code,
  view,
  pending,
  onSigned,
}: {
  code: string;
  view: GroupView;
  pending: number;
  onSigned: () => void | Promise<void>;
}) {
  const [who, setWho] = useState<{ id: string; role: SignRole } | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sigs = view.signatures ?? [];
  const signedBy = (role: SignRole) => sigs.find((s) => s.role === role);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? 'Player';
  const hasSigned = (id: string) => sigs.some((s) => s.playerId === id);

  const choices: { id: string; role: SignRole }[] = [];
  if (view.scorerPlayerId && !signedBy('scorer') && !hasSigned(view.scorerPlayerId)) {
    choices.push({ id: view.scorerPlayerId, role: 'scorer' });
  }
  if (!signedBy('attest')) {
    const others = view.players.filter((p) => p.id !== view.scorerPlayerId && !p.withdrawn && !hasSigned(p.id));
    const eligible = view.kind === 'match' ? (view.players.length === 2 ? others : []) : others;
    for (const p of eligible) choices.push({ id: p.id, role: 'attest' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!who || !/^\d{4}$/.test(pin)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signCard(code, who.id, pin, who.role);
      if (r.ok) {
        setWho(null);
        setPin('');
        await onSigned();
        return;
      }
      setPin('');
      if (r.code === SG.wrongPin) setError('Wrong PIN. Try again.');
      else if (r.code === SG.pinLocked) setError('Too many wrong PINs. Try again later, or ask the commissioner to sign for you.');
      else if (r.code === SG.noPin) {
        setError(`${nameOf(who.id)} has no PIN yet. Set your PIN in the app (Me → PIN), or ask the commissioner to sign for you.`);
      } else {
        setError(r.error);
        setWho(null);
        await onSigned(); // locked, already signed, scores changed: re-read the card
      }
    } catch {
      setError('No signal. Try again when you have a connection.');
    } finally {
      setBusy(false);
    }
  }

  const big = 'min-h-[56px] w-full rounded text-lg font-bold';
  return (
    <section aria-label="Sign card" className="space-y-3 rounded border-4 border-green-800 p-3">
      <h2 className="text-xl font-black">Sign card</h2>
      <ul className="space-y-1 text-lg font-semibold">
        {(['scorer', 'attest'] as const).map((role) => {
          const s = signedBy(role);
          return (
            <li key={role}>
              {ROLE_LABEL[role]}: {s ? `${s.name} ✓ signed` : 'not signed yet'}
            </li>
          );
        })}
      </ul>

      {pending > 0 ? (
        <p className="text-base font-semibold">Waiting to send {pending} score{pending === 1 ? '' : 's'} from this phone before signing.</p>
      ) : !who ? (
        choices.length > 0 && (
          <div className="space-y-2">
            <p className="text-lg font-semibold">Who is signing?</p>
            {choices.map((c) => (
              <button
                key={`${c.role}-${c.id}`}
                type="button"
                onClick={() => {
                  setWho(c);
                  setPin('');
                  setError(null);
                }}
                className={`${big} border-4 border-slate-950 bg-white`}
              >
                {nameOf(c.id)} ({c.role === 'scorer' ? 'scorer' : 'attest'})
              </button>
            ))}
          </div>
        )
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <label className="block text-lg font-semibold">
            PIN for {nameOf(who.id)}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              aria-label={`PIN for ${nameOf(who.id)}`}
              className="mt-1 block min-h-[56px] w-full rounded border-2 border-slate-950 px-3 text-center text-3xl tracking-[0.5em]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setWho(null)} className={`${big} border-4 border-slate-950 bg-white`}>
              Back
            </button>
            <button type="submit" disabled={busy || pin.length !== 4} className={`${big} bg-green-800 text-white disabled:opacity-50`}>
              Sign
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-lg font-semibold text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
