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
        const result = await (registered ? withdraw(eventId) : register(eventId));
        if (!result.ok) {
          setError(result.error);
          return;
        }
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
        className={`w-full disabled:opacity-50 ${
          registered
            ? 'inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 border-white/25 px-5 font-label text-lg font-semibold uppercase tracking-wider text-silver-300'
            : 'btn-gold'
        }`}
      >
        {registered ? 'Withdraw' : 'Register'}
      </button>
      {error && <p role="alert" className="text-sm font-semibold text-brandred-500">{error}</p>}
    </div>
  );
}
