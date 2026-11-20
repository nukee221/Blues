import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { Avatar } from '@/components/Avatar';
import { bracketRoundIds } from '@/lib/bracketRounds';
import { formatHandicap } from '@/lib/handicapFormat';
import { formatDayDate, formatTeeTime } from '@/lib/time';
import { orderGroups } from '@/lib/teeSheetView';

export const dynamic = 'force-dynamic';

type Tee = { name: string; courses: { name: string } | null } | null;

/** The event's tee sheet for players: each round's groups, tee times, start holes and locked-in handicaps. */
export default async function TeeSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { player } = await requireUser();
  const { id } = await params;
  // User-scoped client: RLS hides drafts; group codes are not readable (column grants).
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, name, format, handicap_mode, rounds(id, round_number, play_date, tees(name, courses(name)))')
    .eq('id', id)
    .maybeSingle();
  if (!event) notFound();
  const matchRounds = event.format === 'match_play' ? await bracketRoundIds(supabase, id) : new Set<string>();
  const rounds = [...event.rounds].filter((r) => !matchRounds.has(r.id)).sort((a, b) => a.round_number - b.round_number);

  const { data: groups } = rounds.length
    ? await supabase.from('groups').select('id, round_id, tee_time, start_hole').in('round_id', rounds.map((r) => r.id))
    : { data: [] as { id: string; round_id: string; tee_time: string | null; start_hole: number }[] };
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: members } = groupIds.length
    ? await supabase.from('group_players').select('group_id, player_id, playing_handicap').in('group_id', groupIds)
    : { data: [] as { group_id: string; player_id: string; playing_handicap: number | null }[] };
  const playerIds = [...new Set((members ?? []).map((m) => m.player_id))];
  const { data: people } = playerIds.length
    ? await supabase.from('public_players').select('id, name, home_club, photo_version').in('id', playerIds)
    : { data: [] as { id: string; name: string; home_club: string | null; photo_version: number | null }[] };
  const personOf = new Map((people ?? []).map((p) => [p.id, p]));
  const gross = event.handicap_mode === 'gross';

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/events/${event.id}`} className="eyebrow inline-flex min-h-[44px] items-center text-silver-300">
          ← {event.name}
        </Link>
        <h1 className="display text-5xl">
          Tee <span className="text-gold-grad">sheet</span>
        </h1>
        <p className="mt-2 text-sm text-silver-300">
          {gross ? 'Gross event: no strokes.' : 'The number by each name is the playing handicap, locked in when the tee sheet went out.'}
        </p>
      </div>

      {(groups ?? []).length === 0 && <p className="card-dark p-4 text-silver-300">The tee sheet is not out yet.</p>}

      {rounds.map((r) => {
        const inRound = orderGroups((groups ?? []).filter((g) => g.round_id === r.id));
        if (inRound.length === 0) return null;
        const tee = r.tees as unknown as Tee;
        return (
          <section key={r.id} aria-labelledby={`round-${r.round_number}`} className="space-y-3">
            <h2 id={`round-${r.round_number}`} className="border-b-2 border-gold-400/70 pb-2">
              <span className="eyebrow block text-gold-400">Round {r.round_number}</span>
              <span className="display block text-2xl">{r.play_date ? formatDayDate(r.play_date) : 'Date TBA'}</span>
              {tee && (
                <span className="block text-sm text-silver-300">
                  {tee.courses?.name}
                  {tee.name ? ` · ${tee.name} tees` : ''}
                </span>
              )}
            </h2>
            <ol className="space-y-3">
              {inRound.map((g, gi) => {
                const inGroup = (members ?? []).filter((m) => m.group_id === g.id);
                const mine = inGroup.some((m) => m.player_id === player.id);
                return (
                  <li key={g.id} className={`row-card p-3 ${mine ? 'ring-2 ring-gold-400' : ''}`}>
                    <div className="flex items-baseline justify-between">
                      <span className="display text-2xl text-white">{formatTeeTime(r.play_date, g.tee_time)}</span>
                      <span className="eyebrow text-[10px] text-silver-300">
                        Group {gi + 1} · Hole {g.start_hole}
                      </span>
                    </div>
                    <ul className="mt-2 divide-y divide-white/10">
                      {inGroup.map((m) => {
                        const p = personOf.get(m.player_id);
                        const name = p?.name ?? 'Player';
                        return (
                          <li key={m.player_id} className="flex min-h-[48px] items-center gap-3 py-1.5">
                            <Avatar playerId={m.player_id} name={name} photoVersion={p?.photo_version} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">{name}</span>
                              {p?.home_club && <span className="block truncate text-xs text-silver-400">{p.home_club}</span>}
                            </span>
                            {m.player_id === player.id && <span className="rounded bg-gold-400 px-1.5 text-xs font-bold text-navy-950">You</span>}
                            {!gross && (
                              <span className="display w-10 text-right text-xl text-gold-400" title="Playing handicap">
                                {formatHandicap(m.playing_handicap)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
