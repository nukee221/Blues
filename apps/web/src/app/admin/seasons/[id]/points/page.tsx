import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pointsTable } from '@hgt/scoring';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import PointsAdmin, { type EventValue, type TableValue } from '@/components/PointsAdmin';
import { EVENT_TYPES } from '@/lib/eventStatus';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  regular: 'Regular',
  major: 'Major',
  ryder_cup: 'Ryder Cup',
  championship: 'Championship',
  match_play: 'Match play',
};

/** Commissioner: a season's points tables, finalize / recalculate its events, overrides. */
export default async function SeasonPointsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCommissioner();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createServerClient();
  const { data: season } = await supabase.from('seasons').select('id, year').eq('id', id).maybeSingle();
  if (!season) notFound();

  const [{ data: stored }, { data: events }, { data: roster }] = await Promise.all([
    supabase.from('points_tables').select('event_type, winner_points, table_values').eq('season_id', id),
    supabase.from('events').select('id, name, event_type, status, created_at').eq('season_id', id).order('created_at'),
    supabase.from('public_players').select('id, name').order('name'),
  ]);
  const eventList = (events ?? []) as { id: string; name: string; event_type: string; status: string }[];
  const { data: awards } = eventList.length
    ? await supabase.from('points_awards').select('event_id, player_id, points, override').in('event_id', eventList.map((e) => e.id))
    : { data: [] };
  const people = (roster ?? []) as { id: string; name: string }[];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const byType = new Map(((stored ?? []) as { event_type: string; winner_points: unknown; table_values: unknown[] }[]).map((t) => [t.event_type, t]));
  const tables: TableValue[] = EVENT_TYPES.map((type) => {
    const t = byType.get(type);
    return t
      ? { eventType: type, label: TYPE_LABEL[type] ?? type, winnerPoints: Number(t.winner_points), values: t.table_values.map(Number), stored: true }
      : { eventType: type, label: TYPE_LABEL[type] ?? type, winnerPoints: 500, values: pointsTable(500), stored: false };
  });
  const awardList = (awards ?? []) as { event_id: string; player_id: string; points: unknown; override: boolean }[];
  const eventValues: EventValue[] = eventList
    .filter((e) => e.status !== 'draft')
    .map((e) => ({
      id: e.id,
      name: e.name,
      eventType: e.event_type,
      status: e.status,
      awards: awardList
        .filter((a) => a.event_id === e.id)
        .map((a) => ({ playerId: a.player_id, name: nameOf.get(a.player_id) ?? 'Player', points: Number(a.points), override: a.override })),
    }));

  return (
    <div className="space-y-4">
      <Link href="/admin" className="inline-flex min-h-[44px] items-center text-green-800">
        ← Admin
      </Link>
      <h1 className="text-2xl font-bold">{season.year as number} points</h1>
      <PointsAdmin seasonId={id} tables={tables} events={eventValues} roster={people} />
    </div>
  );
}
