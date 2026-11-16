'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { register, withdraw } from '@/actions/registration';

export default function RegisterButton({ eventId, registered }: { eventId: string; registered: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    start(async () => {
      try {
        await (registered ? withdraw(eventId) : register(eventId));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={go}
        className={`min-h-[44px] rounded px-4 font-semibold disabled:opacity-50 ${
          registered ? 'border border-red-700 text-red-700' : 'bg-green-700 text-white'
        }`}
      >
        {registered ? 'Withdraw' : 'Register'}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
