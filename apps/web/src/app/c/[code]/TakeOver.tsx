'use client';
import { useState } from 'react';
import { takeOverScoring, type GroupView } from '@/actions/scorecard';
import { SC } from '@/lib/scorecardCodes';
import { SG } from '@/lib/signingCodes';

/**
 * "Take over scoring": any non-withdrawn player in the group picks their name and enters their own
 * 4-digit PIN (the same check and lockout as signing); this phone then keeps score.
 */
export default function TakeOver({ code, view, onDone }: { code: string; view: GroupView; onDone: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = view.players.find((p) => p.id === who)?.name ?? 'Player';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!who || !/^\d{4}$/.test(pin)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await takeOverScoring(code, who, pin);
      setPin('');
      if (r.ok) {
        setOpen(false);
        setWho('');
        await onDone();
      } else if (r.code === SG.wrongPin) setError('Wrong PIN. Try again.');
      else if (r.code === SG.pinLocked) setError('Too many wrong PINs. Try again later, or ask the commissioner to free the scorer phone.');
      else if (r.code === SG.noPin) {
        setError(`${name} has no PIN yet. Set your PIN in the app (Me → PIN), or ask the commissioner to free the scorer phone.`);
      } else {
        setError(r.error);
        if (r.code === SC.locked || r.code === SC.conflict) await onDone();
      }
    } catch {
      setError('No signal. Try again when you have a connection.');
    } finally {
      setBusy(false);
    }
  }

  const big = 'min-h-[56px] w-full rounded text-lg font-bold';
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${big} rounded-lg border-2 border-white/40 bg-transparent text-white`}>
        Take over scoring
      </button>
    );
  }
  return (
    <form onSubmit={submit} aria-label="Take over scoring" className="space-y-2 rounded-xl border-2 border-white/30 bg-navy-900 p-3">
      <h2 className="display text-2xl">Take over scoring</h2>
      <label className="block text-lg font-semibold">
        Your name
        <select
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label="Your name"
          className="mt-1 block min-h-[56px] w-full rounded-lg border-2 border-white/30 bg-navy-900 text-white focus:border-gold-400 focus:outline-none px-3 text-lg"
        >
          <option value="">Choose your name</option>
          {view.players.filter((p) => !p.withdrawn).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {who && (
        <label className="block text-lg font-semibold">
          PIN for {name}
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label={`PIN for ${name}`}
            className="mt-1 block min-h-[56px] w-full rounded-lg border-2 border-white/30 bg-navy-900 text-white focus:border-gold-400 focus:outline-none px-3 text-center text-3xl tracking-[0.5em]"
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className={`${big} rounded-lg border-2 border-white/40 bg-transparent text-white`}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !who || pin.length !== 4} className={`${big} bg-brandred-600 text-white disabled:opacity-50`}>
          Take over
        </button>
      </div>
      {error && (
        <p role="alert" className="text-lg font-semibold text-brandred-500">
          {error}
        </p>
      )}
    </form>
  );
}
