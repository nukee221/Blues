import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getStandings } from '@/actions/points';
import { formatPos } from '@/lib/leaderboardFormat';
import { formatPoints, pickCurrentSeason } from '@/lib/standings';

export const dynamic = 'force-dynamic';

/** One player's season: position, total and points per final event (event date order). */
export default async function PlayerStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { player: me } = await requireUser();
  const { playerId } = await params;
  const { season: wanted } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(playerId)) notFound();
  const supabase = await createServerClient();
  const [{ data: seasons }, { data: person }] = await Promise.all([
    supabase.from('seasons').select('id, year'),
    supabase.from('public_players').select('id, name').eq('id', playerId).maybeSingle(),
  ]);
  if (!person) notFound();
  const list = (seasons ?? []) as { id: string; year: number }[];
  const season = list.find((s) => s.id === wanted) ?? pickCurrentSeason(list);
  const result = season ? await getStandings(season.id) : null;
  const row = result?.ok ? result.data.find((r) => r.playerId === playerId) ?? null : null;
  const back = wanted && season ? `/standings?season=${season.id}` : '/standings';

  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex min-h-[44px] items-center text-green-800">
        ← Standings
      </Link>
      <h1 className="text-2xl font-bold">
        {person.name as string}
        {playerId === me.id && <span className="ml-2 rounded bg-yellow-500 px-1.5 align-middle text-sm font-bold text-black">You</span>}
      </h1>
      {result && !result.ok && <p role="alert" className="text-red-700">{result.error}</p>}
      {!row ? (
        <p className="text-gray-700">No points yet{season ? ` in ${season.year}` : ''}.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border p-2">
              <dt className="text-xs uppercase text-gray-600">Pos</dt>
              <dd className="text-xl font-bold">{formatPos(row.position, row.tied)}</dd>
            </div>
            <div className="rounded border p-2">
              <dt className="text-xs uppercase text-gray-600">Points</dt>
              <dd className="text-xl font-bold tabular-nums">{formatPoints(row.total)}</dd>
            </div>
            <div className="rounded border p-2">
              <dt className="text-xs uppercase text-gray-600">Events</dt>
              <dd className="text-xl font-bold">{row.eventsPlayed}</dd>
            </div>
          </dl>
          <p className={`font-semibold ${row.qualified ? 'text-green-800' : 'text-gray-700'}`}>
            {row.qualified ? 'Inside the Season Championship cut' : 'Outside the Season Championship cut'}
          </p>
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b-2 border-gray-900 text-left text-sm uppercase">
                <th className="px-2 py-2">Event</th>
                <th className="px-2 py-2 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {row.byEvent.map((e) => (
                <tr key={e.eventId} className="border-b border-gray-300">
                  <td className="px-2">
                    <Link href={`/events/${e.eventId}`} className="flex min-h-[44px] items-center text-green-900">
                      {e.eventName}
                    </Link>
                  </td>
                  <td className="px-2 text-right font-bold tabular-nums">{formatPoints(e.points)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-900">
                <td className="px-2 py-3 font-semibold">Total</td>
                <td className="px-2 py-3 text-right text-lg font-bold tabular-nums">{formatPoints(row.total)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}
