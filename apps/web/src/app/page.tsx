import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getStandings } from '@/actions/points';
import { pickCurrentSeason, formatPoints } from '@/lib/standings';
import { formatPos } from '@/lib/leaderboardFormat';
import { formatRoundDate } from '@/lib/time';
import { centralToday, findMyStanding, pickNextEvent } from '@/lib/home';

export const dynamic = 'force-dynamic';

type Tee = { courses: { name: string } | null } | null;

/** Home: the tour shield, the next event, a big Enter code button, and the player's standing. */
export default async function Home() {
  const { player } = await requireUser();
  // User-scoped client: RLS hides draft events.
  const supabase = await createServerClient();
  const [{ data: events }, { data: seasons }] = await Promise.all([
    supabase.from('events').select('id, name, format, status, rounds(play_date, tees(courses(name)))'),
    supabase.from('seasons').select('id, year'),
  ]);
  const next = pickNextEvent(events ?? [], centralToday());
  const course = next?.rounds.map((r) => (r.tees as unknown as Tee)?.courses?.name).find(Boolean);
  const season = pickCurrentSeason((seasons ?? []) as { id: string; year: number }[]);
  const standings = season ? await getStandings(season.id) : null;
  const mine = standings?.ok ? findMyStanding(standings.data, player.id) : null;

  return (
    <div className="space-y-5">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand art */}
      <img src="/brand/shield-2027.png" alt="Huntsville Golf Tour 2027" width={1024} height={1008} className="mx-auto h-auto w-40" />
      <p className="text-center text-xl font-bold">Welcome, {player.name.split(' ')[0]}</p>

      <section aria-labelledby="next-event" className="card-dark p-4">
        <h2 id="next-event" className="text-sm font-semibold uppercase tracking-wide text-silver-300">Next event</h2>
        {next ? (
          <Link href={`/events/${next.id}`} className="mt-1 block min-h-[44px]">
            <span className="block font-display text-2xl font-bold">{next.name}</span>
            <span className="block text-gold-400">{formatRoundDate(next.date)}</span>
            <span className="block text-sm text-silver-300">
              {course ? `${course} · ` : ''}
              {next.format === 'match_play' ? 'Match play' : 'Stroke play'}
            </span>
            <span className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-brandred-600 px-4 font-semibold">View event</span>
          </Link>
        ) : (
          <p className="mt-1 text-silver-300">No upcoming events yet.</p>
        )}
      </section>

      <Link href="/c" className="flex min-h-[56px] items-center justify-center rounded-xl bg-navy-900 text-xl font-bold text-white">
        Enter group code
      </Link>

      <section aria-labelledby="my-standing" className="rounded-2xl border-2 border-navy-900 p-4">
        <h2 id="my-standing" className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          {season ? `Your ${season.year} standing` : 'Your standing'}
        </h2>
        {mine ? (
          <Link href="/standings" className="mt-1 flex min-h-[44px] items-baseline justify-between gap-3">
            <span className="text-3xl font-bold">
              {formatPos(mine.position, mine.tied)}
              <span className="text-base font-normal text-gray-600"> of {mine.of}</span>
            </span>
            <span className="text-xl font-bold tabular-nums text-navy-900">{formatPoints(mine.total)} pts</span>
          </Link>
        ) : (
          <p className="mt-1 text-gray-700">
            No points yet this season. <Link href="/standings" className="font-semibold text-navy-900 underline">See standings</Link>
          </p>
        )}
      </section>
    </div>
  );
}
