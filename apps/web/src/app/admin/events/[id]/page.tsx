import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import EventForm, { type EventFormValue } from '@/components/EventForm';
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
    .select('*, rounds(round_number, tee_id, play_date, kind)')
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
  return <EventForm initial={initial} status={event.status as EventStatus} seasons={seasonOptions} tees={teeOptions} />;
}
