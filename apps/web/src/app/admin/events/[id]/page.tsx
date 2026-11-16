import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import EventForm, { type EventFormValue } from '@/components/EventForm';
import AdminRegistrations from '@/components/AdminRegistrations';
import type { EventStatus } from '@/lib/eventStatus';
import { bracketRoundIds } from '@/lib/bracketRounds';
import { eventIsLocked, loadEventLockState } from '@/lib/editLocks';

export const dynamic = 'force-dynamic';

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

/** Groups of the event's rounds whose card is not yet signed, with who is in them and how far along. */
async function unsignedGroups(supabase: Supabase, rounds: { id: string; round_number: number }[]) {
  if (rounds.length === 0) return [];
  const roundNo = new Map(rounds.map((r) => [r.id, r.round_number]));
  const { data: groups } = await supabase
    .from('groups')
    .select('id, round_id, tee_time, locked, signed_at')
    .in('round_id', rounds.map((r) => r.id))
    .eq('locked', false)
    .is('signed_at', null)
    .order('tee_time', { ascending: true, nullsFirst: false });
  const list = groups ?? [];
  if (list.length === 0) return [];
  const ids = list.map((g) => g.id);
  const [{ data: members }, { data: sigs }] = await Promise.all([
    supabase.from('group_players').select('group_id, player_id').in('group_id', ids),
    supabase.from('signatures').select('group_id, role').in('group_id', ids),
  ]);
  const pids = [...new Set((members ?? []).map((m) => m.player_id))];
  const { data: people } = pids.length ? await supabase.from('players').select('id, name').in('id', pids) : { data: [] };
  const name = new Map((people ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  return list
    .map((g) => {
      const n = (sigs ?? []).filter((s) => s.group_id === g.id).length;
      return {
        id: g.id,
        roundNumber: roundNo.get(g.round_id) ?? 0,
        names: (members ?? [])
          .filter((m) => m.group_id === g.id)
          .map((m) => name.get(m.player_id) ?? 'Player')
          .join(', '),
        status: n === 0 ? 'not signed' : '1 of 2 signed',
      };
    })
    .sort((a, b) => a.roundNumber - b.roundNumber);
}

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
  // Per-match rounds (createMatchCard) are managed from the bracket page, not the event form.
  const matchRounds = event.format === 'match_play' ? await bracketRoundIds(supabase, id) : new Set<string>();
  const formRounds = (event.rounds as { id: string; round_number: number; tee_id: string; play_date: string | null; kind: 'stroke' | 'match' }[]).filter(
    (r) => !matchRounds.has(r.id),
  );

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
    rounds: [...formRounds]
      .sort((a, b) => a.round_number - b.round_number)
      .map((r) => ({ roundNumber: r.round_number, teeId: r.tee_id, playDate: r.play_date, kind: r.kind })),
  };
  const [{ data: roster }, { data: regs }] = await Promise.all([
    supabase.from('players').select('id, name').order('name'),
    supabase.from('registrations').select('player_id').eq('event_id', id).eq('status', 'registered'),
  ]);
  const rosterList = roster ?? [];
  const lockState = await loadEventLockState(supabase, id);
  const locked = eventIsLocked(event.status, lockState);
  const roundsWithGroups = lockState.rounds.filter((r) => lockState.roundsWithGroups.has(r.id)).map((r) => r.round_number);
  const unsigned = event.status === 'in_progress' ? await unsignedGroups(supabase, event.rounds) : [];
  const regIds = new Set((regs ?? []).map((r) => r.player_id));
  return (
    <div className="space-y-8">
      <EventForm
        initial={initial}
        status={event.status as EventStatus}
        seasons={seasonOptions}
        tees={teeOptions}
        locked={locked}
        roundsWithGroups={roundsWithGroups}
      />
      {event.status !== 'draft' && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Groups &amp; tee sheets</h2>
          {event.format === 'match_play' && (
            <Link
              href={`/admin/events/${id}/bracket`}
              className="flex min-h-[44px] items-center rounded border-2 border-green-800 px-3 font-semibold text-green-800"
            >
              Match-play bracket
            </Link>
          )}
          {[...formRounds]
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
      {event.status === 'in_progress' && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Unsigned cards</h2>
          {unsigned.length === 0 ? (
            <p className="text-gray-600">Every card is signed.</p>
          ) : (
            unsigned.map((g) => (
              <Link
                key={g.id}
                href={`/admin/cards/${g.id}`}
                className="flex min-h-[44px] items-center justify-between rounded border px-3 font-semibold text-green-800"
              >
                <span>
                  Round {g.roundNumber} · {g.names || 'Empty group'}
                </span>
                <span className="text-sm text-gray-700">{g.status}</span>
              </Link>
            ))
          )}
        </section>
      )}
      <AdminRegistrations eventId={id} registered={rosterList.filter((p) => regIds.has(p.id))} roster={rosterList} />
    </div>
  );
}
