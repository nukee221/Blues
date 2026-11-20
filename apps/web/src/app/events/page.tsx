import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { pickCurrentSeason } from '@/lib/standings';
import { buildEventRows, ribbonText } from '@/lib/eventCards';
import { EventRowCard } from '@/components/EventRowCard';

export const dynamic = 'force-dynamic';

/** This season's events in the poster layout: what's coming up (numbered), then what's been played. */
export default async function EventsPage() {
  await requireUser();
  // User-scoped client: RLS hides draft events.
  const supabase = await createServerClient();
  const [{ data: events }, { data: seasons }] = await Promise.all([
    supabase.from('events').select('id, name, format, status, season_id, rounds(play_date, tees(courses(name)))'),
    supabase.from('seasons').select('id, year'),
  ]);
  const season = pickCurrentSeason((seasons ?? []) as { id: string; year: number }[]);
  const mine = (events ?? []).filter((e) => !season || e.season_id === season.id);
  const { upcoming, completed } = buildEventRows(mine, season?.year ?? new Date().getFullYear());

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="eyebrow text-gold-400">
          Official <span className="text-white">{season?.year ?? ''} season</span>
        </p>
        <h1 className="display mt-3 text-5xl">
          The <span className="text-gold-grad">{season?.year ?? ''}</span> Events
        </h1>
        <div className="mt-4">
          <span className="ribbon text-xs">
            <span>{ribbonText(upcoming)}</span>
          </span>
        </div>
      </div>

      {upcoming.length === 0 && completed.length === 0 && <p className="text-center text-silver-300">No events yet.</p>}

      {upcoming.length > 0 && (
        <ul className="-mx-2 space-y-3" aria-label="Upcoming events">
          {upcoming.map((r) => (
            <li key={r.id}>
              <EventRowCard row={r} />
            </li>
          ))}
        </ul>
      )}

      {upcoming.some((r) => !r.date) && (
        <p className="eyebrow text-center text-gold-400">
          Dates &amp; courses <span className="text-white">announced soon</span>
        </p>
      )}

      {completed.length > 0 && (
        <section aria-labelledby="played" className="space-y-3">
          <h2 id="played" className="eyebrow border-t-2 border-gold-400/70 pt-4 text-center text-silver-300">
            Played this season
          </h2>
          <ul className="-mx-2 space-y-3">
            {completed.map((r) => (
              <li key={r.id}>
                <EventRowCard row={r} compact />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
