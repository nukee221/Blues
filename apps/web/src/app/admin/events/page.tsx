import Link from 'next/link';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import EventStatusButtons from '@/components/EventStatusButtons';
import type { EventStatus } from '@/lib/eventStatus';

export const dynamic = 'force-dynamic';

export default async function AdminEventsPage() {
  await requireCommissioner();
  const supabase = await createServerClient();
  const { data: events } = await supabase
    .from('events')
    .select('id, name, status, format, registration_deadline, created_at')
    .order('created_at', { ascending: false });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Events</h1>
      <Link href="/admin/events/new" className="flex min-h-[44px] items-center justify-center rounded bg-green-700 px-4 font-semibold text-white">
        Add event
      </Link>
      <ul className="space-y-3">
        {(events ?? []).map((e) => (
          <li key={e.id} className="space-y-2 rounded border p-3">
            <Link href={`/admin/events/${e.id}`} className="block min-h-[44px]">
              <div className="font-semibold">{e.name}</div>
              <div className="text-sm text-gray-600">
                {e.status.replace('_', ' ')} · {e.format === 'match_play' ? 'Match play' : 'Stroke'}
              </div>
            </Link>
            <EventStatusButtons eventId={e.id} status={e.status as EventStatus} />
          </li>
        ))}
      </ul>
    </div>
  );
}
