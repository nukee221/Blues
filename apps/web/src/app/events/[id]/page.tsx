import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCentral } from '@/lib/time';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { advanceCount } from '@hgt/scoring';
import RegisterButton from '@/components/RegisterButton';

export const dynamic = 'force-dynamic';

type Tee = { name: string; courses: { name: string } | null };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { player } = await requireUser();
  const { id } = await params;
  // User-scoped client: RLS makes drafts invisible (-> 404).
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, name, format, status, registration_deadline, rounds(round_number, play_date, tees(name, courses(name)))')
    .eq('id', id)
    .maybeSingle();
  if (!event) notFound();

  const { data: regs } = await supabase
    .from('registrations')
    .select('player_id')
    .eq('event_id', id)
    .eq('status', 'registered');
  const ids = (regs ?? []).map((r) => r.player_id);
  const { data: players } = ids.length
    ? await supabase.from('public_players').select('id, name').in('id', ids)
    : { data: [] as { id: string; name: string }[] };
  const isRegistered = ids.includes(player.id);
  const names = (players ?? []).map((p) => p.name).sort((a, b) => a.localeCompare(b));

  const deadlineMs = event.registration_deadline ? new Date(event.registration_deadline).getTime() : null;
  const open = event.status === 'published' && deadlineMs !== null && Date.now() < deadlineMs;
  const rounds = [...event.rounds].sort((a, b) => a.round_number - b.round_number);
  const dates = rounds.map((r) => r.play_date).filter((d): d is string => !!d).sort();
  const courses = [...new Set(rounds.map((r) => (r.tees as unknown as Tee | null)?.courses?.name).filter(Boolean))];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{event.name}</h1>
      <dl className="space-y-2 text-sm">
        <div><dt className="font-medium">Date</dt><dd>{dates.length ? [...new Set(dates)].join(', ') : 'TBD'}</dd></div>
        <div><dt className="font-medium">Course</dt><dd>{courses.length ? courses.join(', ') : 'TBD'}</dd></div>
        <div><dt className="font-medium">Format</dt><dd>{event.format === 'match_play' ? 'Match play' : 'Stroke play'}</dd></div>
        <div>
          <dt className="font-medium">Registration deadline</dt>
          <dd>{event.registration_deadline ? formatCentral(event.registration_deadline) : 'None'}</dd>
        </div>
      </dl>
      {event.format === 'match_play' && (
        <p className="text-sm">Top {advanceCount(ids.length)} advance (8 at 16+ players)</p>
      )}
      <Link href={`/events/${event.id}/leaderboard`} className="flex min-h-[44px] items-center justify-center rounded border-2 border-gray-900 px-4 font-semibold">
        Leaderboard
      </Link>
      {open ? (
        <RegisterButton eventId={event.id} registered={isRegistered} />
      ) : (
        <p className="text-sm text-gray-600">Registration is closed.</p>
      )}
      <section>
        <h2 className="text-lg font-semibold">Registered ({names.length})</h2>
        {names.length === 0 ? (
          <p className="text-sm text-gray-600">Nobody yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {names.map((n, i) => <li key={`${n}-${i}`} className="min-h-[44px] rounded border px-3 py-3">{n}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
