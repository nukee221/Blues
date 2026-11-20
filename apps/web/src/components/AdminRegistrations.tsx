'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminSetRegistration } from '@/actions/registration';

export type RosterPlayer = { id: string; name: string };

export default function AdminRegistrations({
  eventId,
  registered,
  roster,
}: {
  eventId: string;
  registered: RosterPlayer[];
  roster: RosterPlayer[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const inField = new Set(registered.map((p) => p.id));
  const available = roster.filter((p) => !inField.has(p.id));

  function set(playerId: string, status: 'registered' | 'withdrawn') {
    setError(null);
    start(async () => {
      try {
        const result = await adminSetRegistration(eventId, playerId, status);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPick('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
      }
    });
  }

  return (
    <section id="registrations" className="scroll-mt-20 space-y-3">
      <h2 className="text-lg font-semibold">Registered ({registered.length})</h2>
      <ul className="space-y-1">
        {registered.map((p) => (
          <li key={p.id} className="flex min-h-[44px] items-center justify-between rounded border px-3">
            <span>{p.name}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => set(p.id, 'withdrawn')}
              className="min-h-[44px] px-3 text-red-700 disabled:opacity-50"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <select
          aria-label="Player to add"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="min-h-[44px] flex-1 rounded border px-3 text-base"
        >
          <option value="">Add a player…</option>
          {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button
          type="button"
          disabled={pending || !pick}
          onClick={() => set(pick, 'registered')}
          className="min-h-[44px] rounded bg-green-700 px-4 font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
