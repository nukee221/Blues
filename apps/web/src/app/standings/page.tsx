import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getStandings } from '@/actions/points';
import StandingsTable from '@/components/StandingsTable';
import { pickCurrentSeason } from '@/lib/standings';

export const dynamic = 'force-dynamic';

/** Season standings (this season unless ?season= names another): points from final events. */
export default async function StandingsPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { player } = await requireUser();
  const { season: wanted } = await searchParams;
  const supabase = await createServerClient();
  const { data: seasons } = await supabase.from('seasons').select('id, year').order('year', { ascending: false });
  const list = (seasons ?? []) as { id: string; year: number }[];
  const season = list.find((s) => s.id === wanted) ?? pickCurrentSeason(list);
  if (!season) {
    return (
      <div className="space-y-4">
        <h1 className="display text-5xl">Standings</h1>
        <p className="text-silver-300">No season has been set up yet.</p>
      </div>
    );
  }
  const result = await getStandings(season.id);
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow text-gold-400">Season points race</p>
        <h1 className="display mt-2 text-5xl">
          <span className="text-gold-grad pr-1">{season.year}</span> Standings
        </h1>
      </div>
      <p className="text-sm text-silver-300">Points from final events. The top 8 qualify for the Season Championship. Tap a player for their events.</p>
      {result.ok ? <StandingsTable rows={result.data} me={player.id} seasonId={wanted ? season.id : undefined} /> : <p role="alert" className="text-brandred-500">{result.error}</p>}
      {list.length > 1 && (
        <nav aria-label="Seasons" className="flex flex-wrap gap-2">
          {list.map((s) => (
            <Link
              key={s.id}
              href={`/standings?season=${s.id}`}
              aria-current={s.id === season.id ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-lg border px-4 font-label font-semibold tracking-wider ${s.id === season.id ? 'border-gold-400 bg-gold-400 text-navy-950' : 'border-white/20 text-silver-300'}`}
            >
              {s.year}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
