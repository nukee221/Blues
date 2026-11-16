import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  await requireUser();
  // User-scoped client: RLS hides draft events.
  const supabase = await createServerClient();
  const { data: events } = await supabase
    .from('events')
    .select('id, name, format, status, registration_deadline, rounds(play_date)')
    .order('created_at', { ascending: false });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Events</h1>
      {(events ?? []).length === 0 && <p className="text-gray-600">No events yet.</p>}
      <ul className="space-y-2">
        {(events ?? []).map((e) => {
          const dates = e.rounds.map((r) => r.play_date).filter((d): d is string => !!d).sort();
          return (
            <li key={e.id}>
              <Link href={`/events/${e.id}`} className="block min-h-[44px] rounded border p-3">
                <div className="font-semibold">{e.name}</div>
                <div className="text-sm text-gray-600">
                  {dates[0] ?? 'Date TBD'} · {e.format === 'match_play' ? 'Match play' : 'Stroke'} · {e.status.replace('_', ' ')}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
