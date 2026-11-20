import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getStandings } from '@/actions/points';
import { pickCurrentSeason, formatPoints } from '@/lib/standings';
import { formatPos } from '@/lib/leaderboardFormat';
import { formatRoundDate } from '@/lib/time';
import { centralToday, findMyStanding, pickNextEvent } from '@/lib/home';
import { championsFor, defendingChampion } from '@/lib/champions';

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

  const year = season?.year ?? Number(centralToday().slice(0, 4));
  const defending = next ? defendingChampion(next.name, year) : null;
  const lastChampions = championsFor(year - 1);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-silver-300">Welcome back</span>
        <span className="eyebrow text-gold-400">
          Official <span className="text-white">{year} season</span>
        </span>
      </div>

      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand art */}
        <img src="/brand/shield-2027-transparent.png" alt="Huntsville Golf Tour 2027" width={512} height={504} className="mx-auto h-auto w-36 drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]" />
        <h1 className="display mt-4 text-5xl text-white">{player.name.split(' ')[0]}</h1>
        <div className="mt-3">
          <span className="ribbon text-sm">
            <span>Your {year} season</span>
          </span>
        </div>
      </div>

      <section aria-labelledby="next-event">
        <h2 id="next-event" className="eyebrow mb-2 text-gold-400">Next event</h2>
        {next ? (
          <Link href={`/events/${next.id}`} className="row-card block p-4">
            <span className="display block text-3xl text-white">{next.name}</span>
            <span className="mt-1 block text-sm text-silver-300">
              {course ? `${course} · ` : ''}
              {next.format === 'match_play' ? 'Match play' : 'Stroke play'}
            </span>
            <span className="mt-3 flex items-end justify-between gap-3">
              <span>
                <span className="eyebrow block text-silver-400">Date</span>
                <span className="display block text-2xl text-white">{next.date ? formatRoundDate(next.date) : 'TBA'}</span>
              </span>
              <span className="btn-red shrink-0">View</span>
            </span>
            {defending && (
              <span className="mt-3 block border-t border-white/10 pt-3">
                <span className="eyebrow block text-silver-400">Defending champion</span>
                <span className="display block text-xl text-gold-400">{defending.champion}</span>
                {defending.note && <span className="block text-sm text-silver-300">{defending.note}</span>}
              </span>
            )}
          </Link>
        ) : (
          <p className="row-card p-4 text-silver-300">No upcoming events yet. Dates &amp; courses announced soon.</p>
        )}
      </section>

      <Link href="/c" className="btn-gold w-full text-xl">
        Enter group code
      </Link>

      <section aria-labelledby="my-standing" className="card-dark p-4">
        <h2 id="my-standing" className="eyebrow text-silver-300">
          {season ? `Your ${season.year} standing` : 'Your standing'}
        </h2>
        {mine ? (
          <Link href="/standings" className="mt-2 flex min-h-[44px] items-end justify-between gap-3">
            <span className="display text-6xl">
              <span className="text-gold-grad">{formatPos(mine.position, mine.tied)}</span>
              <span className="ml-2 font-sans text-base not-italic normal-case text-silver-300">of {mine.of}</span>
            </span>
            <span className="text-right">
              <span className="display block text-3xl text-white">{formatPoints(mine.total)}</span>
              <span className="eyebrow text-silver-400">Points</span>
            </span>
          </Link>
        ) : (
          <p className="mt-2 text-silver-300">
            No points yet this season.{' '}
            <Link href="/standings" className="font-semibold text-gold-400 underline">
              See standings
            </Link>
          </p>
        )}
      </section>

      {lastChampions.length > 0 && (
        <section aria-labelledby="champions" className="-mx-5 border-y-2 border-gold-400/70 bg-navy-950/80 px-4 py-5 text-center">
          <h2 id="champions" className="font-label text-xl font-bold uppercase tracking-[0.3em] text-gold-400">
            {year - 1} Champions
          </h2>
          <ul className="mx-auto mt-4 max-w-sm divide-y divide-white/10 border-y border-white/10 text-left">
            {lastChampions.map((c) => (
              <li key={c.title} className="grid min-h-[64px] grid-cols-[7.5rem_1fr] items-center gap-3 py-3">
                <span className="eyebrow text-[11px] leading-snug tracking-[0.18em] text-silver-400">{c.title}</span>
                <span>
                  <span className="display block text-2xl text-white">{c.champion}</span>
                  {c.note && <span className="mt-0.5 block text-xs text-silver-300">{c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
