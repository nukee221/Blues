'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setEventStatus } from '@/actions/events';
import { nextStatuses, STATUS_ACTION_LABEL, type EventStatus } from '@/lib/eventStatus';

export default function EventStatusButtons({ eventId, status }: { eventId: string; status: EventStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(to: EventStatus) {
    setError(null);
    start(async () => {
      try {
        const result = await setEventStatus(eventId, to);
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
      <div className="flex flex-wrap gap-2">
        {nextStatuses(status).map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => go(to)}
            className="min-h-[44px] rounded bg-green-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {STATUS_ACTION_LABEL[`${status}>${to}`] ?? to}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
