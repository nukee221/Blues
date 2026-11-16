'use client';
import { useState } from 'react';
import { setPin } from '@/actions/signing';

export default function PinForm({ hasPin }: { hasPin: boolean }) {
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!/^\d{4}$/.test(pin)) return setError('Enter exactly 4 digits.');
    if (pin !== confirm) return setError('The two PINs do not match.');
    setBusy(true);
    try {
      const r = await setPin(pin);
      if (r.ok) {
        setDone(true);
        setPinValue('');
        setConfirm('');
      } else setError(r.code === 'invalid' ? 'Enter exactly 4 digits.' : r.error);
    } catch {
      setError('Could not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'mt-1 block min-h-[56px] w-full rounded border-2 border-slate-950 px-3 text-center text-3xl tracking-[0.5em]';
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-lg font-semibold">
        {hasPin ? 'New PIN' : 'PIN'}
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="new-password"
          value={pin}
          onChange={(e) => setPinValue(digits(e.target.value))}
          className={input}
        />
      </label>
      <label className="block text-lg font-semibold">
        Repeat PIN
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(digits(e.target.value))}
          className={input}
        />
      </label>
      <button type="submit" disabled={busy} className="min-h-[56px] w-full rounded bg-green-800 text-lg font-bold text-white disabled:opacity-50">
        Save PIN
      </button>
      {error && (
        <p role="alert" className="text-lg font-semibold text-red-800">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-lg font-semibold text-green-800">
          PIN saved.
        </p>
      )}
    </form>
  );
}
