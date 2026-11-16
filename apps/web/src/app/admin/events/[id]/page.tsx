import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import EventForm, { type EventFormValue } from '@/components/EventForm';
import AdminRegistrations from '@/components/AdminRegistrations';
import type { EventStatus } from '@/lib/eventStatus';

export const dynamic = 'force-dynamic';

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCommissioner();
  const { id } = await params;
  const supabase = await createServerClient();

  const [{ data: seasons }, { data: tees }] = await Promise.all([
    supabase.from('seasons').select('id, year').order('year', { ascending: false }),
    supabase.from('tees').select('id, name, courses(name)').order('name'),
  ]);
  const seasonOptions = seasons ?? [];
  const teeOptions = (tees ?? []).map((t) => ({
    id: t.id,
    label: `${(t.courses as unknown as { name: string } | null)?.name ?? 'Course'} – ${t.name}`,
  }));

  if (id === 'new') {
    const initial: EventFormValue = {
      seasonId: seasonOptions[0]?.id ?? '',
      name: '',
      eventType: 'regular',
      format: 'stroke',
      handicapMode: 'net',
      allowancePct: 100,
      handicapBasis: 'index',
      matchStrokes: 'full',
      registrationDeadline: '',
      rounds: [{ roundNumber: 1, teeId: '', playDate: null, kind: 'stroke' }],
    };
    return <EventForm initial={initial} seasons={seasonOptions} tees={teeOptions} />;
  }

  const { data: event } = await supabase
    .from('events')
    .select('*, rounds(id, round_number, tee_id, play_date, kind)')
    .eq('id', id)
    .maybeSingle();
  if (!event) notFound();

  const initial: EventFormValue = {
    id: event.id,
    seasonId: event.season_id,
    name: event.name,
    eventType: event.event_type,
    format: event.format === 'match_play' ? 'match_play' : 'stroke',
    handicapMode: event.handicap_mode === 'gross' ? 'gross' : 'net',
    allowancePct: event.allowance_pct,
    handicapBasis: event.handicap_basis,
    matchStrokes: event.match_strokes,
    registrationDeadline: event.registration_deadline ?? '',
    rounds: [...event.rounds]
      .sort((a, b) => a.round_number - b.round_number)
      .map((r) => ({ roundNumber: r.round_number, teeId: r.tee_id, playDate: r.play_date, kind: r.kind })),
  };
  const [{ data: roster }, { data: regs }] = await Promise.all([
    supabase.from('players').select('id, name').order('name'),
    supabase.from('registrations').select('player_id').eq('event_id', id).eq('status', 'registered'),
  ]);
  const rosterList = roster ?? [];
  const regIds = new Set((regs ?? []).map((r) => r.player_id));
  return (
    <div className="space-y-8">
      <EventForm initial={initial} status={event.status as EventStatus} seasons={seasonOptions} tees={teeOptions} />
      {event.status !== 'draft' && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Groups &amp; tee sheets</h2>
          {[...event.rounds]
            .sort((a, b) => a.round_number - b.round_number)
            .map((r) => (
              <Link
                key={r.id}
                href={`/admin/events/${id}/rounds/${r.id}`}
                className="flex min-h-[44px] items-center rounded border px-3 font-semibold text-green-800"
              >
                Round {r.round_number} groups
              </Link>
            ))}
        </section>
      )}
      <AdminRegistrations eventId={id} registered={rosterList.filter((p) => regIds.has(p.id))} roster={rosterList} />
    </div>
  );
}
