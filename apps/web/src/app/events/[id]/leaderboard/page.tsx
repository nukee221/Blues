import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getRoundLeaderboard } from '@/actions/leaderboard';
import Live from './Live';
import { bracketRoundIds } from '@/lib/bracketRounds';

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ round?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { round } = await searchParams;
  // User-scoped client: RLS makes drafts invisible (-> 404).
  const supabase = await createServerClient();
  const { data: event } = await supabase.from('events').select('id, name').eq('id', id).maybeSingle();
  if (!event) notFound();
  const { data: roundRows } = await supabase.from('rounds').select('id, round_number').eq('event_id', id);
  // Match-play bracket matches have their own rounds; they show on the bracket, not as stroke boards.
  const matchRounds = await bracketRoundIds(supabase, id);
  const rounds = [...(roundRows ?? [])].filter((r) => !matchRounds.has(r.id)).sort((a, b) => a.round_number - b.round_number);
  if (rounds.length === 0) notFound();

  let chosen = rounds.find((r) => String(r.round_number) === round);
  if (!chosen) {
    // Default: the latest round that has scores, else round 1.
    for (const r of [...rounds].reverse()) {
      const { data: groups } = await supabase.from('groups').select('id').eq('round_id', r.id);
      const ids = (groups ?? []).map((g) => g.id);
      if (!ids.length) continue;
      const { data: hit } = await supabase.from('scores').select('id').in('group_id', ids).limit(1);
      if (hit && hit.length) {
        chosen = r;
        break;
      }
    }
    chosen ??= rounds[0]!;
  }

  const result = await getRoundLeaderboard(chosen.id);
  if (!result.ok) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/events/${id}`} className="text-sm underline">Back to event</Link>
        <h1 className="text-2xl font-bold">{event.name}</h1>
        <h2 className="text-lg text-gray-700">Round {chosen.round_number} leaderboard</h2>
      </div>
      {rounds.length > 1 && (
        <nav aria-label="Rounds" className="flex flex-wrap gap-2">
          {rounds.map((r) => (
            <Link
              key={r.id}
              href={`/events/${id}/leaderboard?round=${r.round_number}`}
              className={`flex min-h-[44px] items-center rounded border-2 px-4 font-semibold ${r.id === chosen.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-400'}`}
            >
              Round {r.round_number}
            </Link>
          ))}
        </nav>
      )}
      <Live key={chosen.id} roundId={chosen.id} initial={result.data} />
    </div>
  );
}
