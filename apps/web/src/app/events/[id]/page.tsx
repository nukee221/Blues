import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCentral, formatDayDate } from '@/lib/time';
import { Avatar } from '@/components/Avatar';
import { defendingChampion } from '@/lib/champions';
import { coursesInOrder, eventLogo } from '@/lib/eventCards';
import { LogoTile } from '@/components/LogoTile';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { advanceCount } from '@hgt/scoring';
import RegisterButton from '@/components/RegisterButton';
import { bracketRoundIds } from '@/lib/bracketRounds';

export const dynamic = 'force-dynamic';

type Tee = { name: string; courses: { name: string } | null };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { player } = await requireUser();
  const { id } = await params;
  // User-scoped client: RLS makes drafts invisible (-> 404).
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, name, format, status, registration_deadline, seasons(year), rounds(id, round_number, play_date, tees(name, courses(name)))')
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
    ? await supabase.from('public_players').select('id, name, home_club, photo_version').in('id', ids)
    : { data: [] as { id: string; name: string; home_club: string | null; photo_version: number | null }[] };
  const isRegistered = ids.includes(player.id);
  const field = [...(players ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const deadlineMs = event.registration_deadline ? new Date(event.registration_deadline).getTime() : null;
  const open = event.status === 'published' && deadlineMs !== null && Date.now() < deadlineMs;
  // Per-match rounds (one per bracket match) are shown on the bracket page, not here.
  const matchRounds = event.format === 'match_play' ? await bracketRoundIds(supabase, id) : new Set<string>();
  const rounds = [...event.rounds].filter((r) => !matchRounds.has(r.id)).sort((a, b) => a.round_number - b.round_number);
  const dates = rounds.map((r) => r.play_date).filter((d): d is string => !!d).sort();
  const courses = coursesInOrder(rounds);
  // Two- and three-day events can move courses: then list each round's day and course.
  const schedule = rounds.map((r) => ({
    key: r.id,
    label: `Round ${r.round_number}`,
    day: r.play_date ? formatDayDate(r.play_date) : 'TBA',
    course: (r.tees as unknown as Tee | null)?.courses?.name ?? 'TBA',
  }));
  const multiRound = schedule.length > 1;

  const year = (event.seasons as unknown as { year: number } | null)?.year ?? null;
  const defending = year ? defendingChampion(event.name, year) : null;
  const logo = eventLogo(event.name);
  const uniqueDates = [...new Set(dates)];
  // One round: Date and Course. Two or three rounds (36/54 holes, maybe on different courses): a schedule instead.
  const facts: [string, string][] = [
    ...(multiRound
      ? []
      : ([
          ['Date', uniqueDates.length ? uniqueDates.map(formatDayDate).join(' & ') : 'TBA'],
          ['Course', courses[0] ?? 'TBA'],
        ] as [string, string][])),
    ['Format', event.format === 'match_play' ? 'Match play' : `${rounds.length * 18} holes, stroke`],
    ['Register by', event.registration_deadline ? formatCentral(event.registration_deadline) : 'No deadline'],
  ];

  return (
    <div className="space-y-6">
      {/* Banner, as in public/brand/event-banner-example.png: logo on white, red stripe, navy title. */}
      <header className="-mx-5 flex min-h-[176px] overflow-hidden border-y border-white/10 shadow-lg shadow-black/40">
        <div className="flex w-[34%] shrink-0 items-center justify-center bg-navy-900 p-3">
          <LogoTile src={logo === '/brand/flag-icon.png' ? '/brand/shield-2027-transparent.png' : logo} size={100} />
        </div>
        <div className="w-1.5 shrink-0 bg-brandred-600 shadow-[2px_0_0_0_theme(colors.silver.300)]" />
        <div className="flex min-w-0 flex-1 flex-col justify-center bg-navy-800 px-4 py-4">
          <p className="eyebrow text-[10px] text-silver-300">Huntsville Golf Tour</p>
          {year && !event.name.includes(String(year)) && (
            <p className="display mt-1 text-4xl">
              <span className="text-gold-grad">{year}</span>
            </p>
          )}
          <h1 className="display mt-1 text-3xl text-white">
            {year && event.name.includes(String(year))
              ? event.name.split(String(year)).flatMap((part: string, i: number) => (i === 0 ? [part] : [<span key={i} className="text-gold-grad">{year}</span>, part]))
              : event.name}
          </h1>
          <span className="mt-3 block h-1 w-12 bg-brandred-600" />
        </div>
      </header>

      <dl className="card-dark grid grid-cols-2 gap-x-4 gap-y-4 p-4">
        {multiRound && (
          <div className="col-span-2">
            <dt className="eyebrow text-[10px] text-silver-400">Schedule</dt>
            <dd>
              <ol className="mt-1 divide-y divide-white/10">
                {schedule.map((r) => (
                  <li key={r.key} className="flex items-center gap-3 py-2">
                    <span className="eyebrow w-16 shrink-0 text-[10px] tracking-[0.15em] text-gold-400">{r.label}</span>
                    <span className="min-w-0">
                      <span className="display block text-xl text-white">{r.day}</span>
                      <span className="block text-sm text-silver-300">{r.course}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        )}
        {facts.map(([k, v]) => (
          <div key={k} className={k === 'Date' || k === 'Course' ? 'col-span-2' : ''}>
            <dt className="eyebrow text-[10px] text-silver-400">{k}</dt>
            <dd className={k === 'Date' ? 'display mt-1 text-2xl text-white' : 'mt-1 whitespace-pre-line font-semibold text-white'}>{v}</dd>
          </div>
        ))}
        {defending && (
          <div className="col-span-2 border-t border-white/10 pt-3">
            <dt className="eyebrow text-[10px] text-silver-400">Defending champion</dt>
            <dd className="display mt-1 text-xl text-gold-400">{defending.champion}</dd>
            {defending.note && <dd className="text-sm text-silver-300">{defending.note}</dd>}
          </div>
        )}
      </dl>

      {event.format === 'match_play' && (
        <p className="text-sm text-silver-300">Top {advanceCount(ids.length)} advance (8 at 16+ players)</p>
      )}

      <div className="space-y-3">
        {open ? (
          <RegisterButton eventId={event.id} registered={isRegistered} />
        ) : (
          <p className="eyebrow text-center text-silver-400">Registration is closed</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Link href={`/events/${event.id}/leaderboard`} className={`btn-red ${event.format === 'match_play' ? '' : 'col-span-2'}`}>
            Leaderboard
          </Link>
          {event.format === 'match_play' && (
            <Link href={`/events/${event.id}/bracket`} className="btn-red">
              Bracket
            </Link>
          )}
        </div>
      </div>

      <section aria-labelledby="field">
        <h2 id="field" className="eyebrow flex items-baseline justify-between border-b-2 border-gold-400/70 pb-2 text-silver-300">
          <span>Registered</span>
          <span className="display text-2xl tracking-normal text-white">{field.length}</span>
        </h2>
        {field.length === 0 ? (
          <p className="mt-3 text-sm text-silver-300">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {field.map((p) => (
              <li key={p.id} className="flex min-h-[56px] items-center gap-3 py-2">
                <Avatar playerId={p.id} name={p.name} photoVersion={p.photo_version} size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  {p.home_club && <span className="block truncate text-xs text-silver-400">{p.home_club}</span>}
                </span>
                {p.id === player.id && <span className="ml-auto rounded bg-gold-400 px-1.5 text-xs font-bold text-navy-950">You</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
