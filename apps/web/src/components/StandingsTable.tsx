import Link from 'next/link';
import { Fragment } from 'react';
import type { StandingsEntry } from '@/actions/points';
import { formatPos } from '@/lib/leaderboardFormat';
import { formatPoints } from '@/lib/standings';
import { formatHandicap } from '@/lib/handicapFormat';

/** The season's events that awarded points, in season order (each player's byEvent carries the number). */
function eventColumns(rows: StandingsEntry[]) {
  const byNumber = new Map<number, { eventId: string; eventName: string }>();
  for (const r of rows) for (const b of r.byEvent) byNumber.set(b.eventNumber, { eventId: b.eventId, eventName: b.eventName });
  return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e);
}

// Pos and Player stay put while the event columns scroll sideways. Fixed widths keep them aligned.
const POS = 'sticky left-0 z-[1] w-12 min-w-12 bg-inherit px-2';
const PLAYER = 'sticky left-12 z-[1] w-44 min-w-44 max-w-44 bg-inherit px-2 shadow-[1px_0_0_0_theme(colors.gray.300)]';

/**
 * Season standings: Pos (T on ties), Player with handicap index, Total (2 decimals), then a column
 * per event ("–" where the player did not score). Scrolls sideways on a phone. A labelled line runs
 * under the last qualifier (8th, or everyone tied at 8th). The viewer's own row is highlighted;
 * each name opens the player's per-event breakdown.
 */
export default function StandingsTable({ rows, me, seasonId }: { rows: StandingsEntry[]; me: string; seasonId?: string }) {
  if (rows.length === 0) return <p className="text-gray-700">No points awarded yet this season.</p>;
  const lastQualified = rows.reduce((at, r, i) => (r.qualified ? i : at), -1);
  const q = seasonId ? `?season=${seasonId}` : '';
  const events = eventColumns(rows);
  return (
    <div>
    <p className="pb-2 text-sm text-gray-600">
      Under each name: handicap index.{events.length > 0 && <strong className="font-semibold text-navy-900"> Swipe the table sideways for each event →</strong>}
    </p>
    <div className="-mx-4 overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-base">
        <thead>
          <tr className="border-b-2 border-gray-900 bg-white text-left text-sm uppercase">
            <th className={`${POS} py-2`}>Pos</th>
            <th className={`${PLAYER} py-2`}>Player</th>
            <th className="px-2 py-2 text-right">Total</th>
            {events.map((e) => (
              <th key={e.eventId} title={e.eventName} className="max-w-28 px-2 py-2 text-right align-bottom text-xs normal-case leading-tight">
                {e.eventName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const mine = r.playerId === me;
            const pts = new Map(r.byEvent.map((b) => [b.eventId, b.points]));
            return (
              <Fragment key={r.playerId}>
                <tr className={`border-b border-gray-300 ${mine ? 'bg-yellow-100 font-semibold' : 'bg-white'}`} aria-current={mine ? 'true' : undefined}>
                  <td className={`${POS} font-semibold`}>{formatPos(r.position, r.tied)}</td>
                  <td className={PLAYER}>
                    <Link href={`/standings/${r.playerId}${q}`} className="flex min-h-[44px] items-center gap-1.5 font-medium text-green-900 underline-offset-2 hover:underline">
                      <span className="truncate">{r.name}</span>
                    </Link>
                    <span className="-mt-2 flex items-center gap-2 pb-1 text-xs font-normal tabular-nums text-gray-600">
                      <span title="Handicap index">{formatHandicap(r.handicapIndex)}</span>
                      {mine && <span className="rounded bg-yellow-500 px-1.5 font-bold text-black">You</span>}
                    </span>
                  </td>
                  <td className="px-2 text-right text-lg font-bold tabular-nums">{formatPoints(r.total)}</td>
                  {events.map((e) => {
                    const p = pts.get(e.eventId);
                    return (
                      <td key={e.eventId} className={`px-2 text-right tabular-nums ${p === undefined ? 'text-gray-400' : ''}`}>
                        {p === undefined ? '–' : formatPoints(p)}
                      </td>
                    );
                  })}
                </tr>
                {i === lastQualified && (
                  <tr data-testid="championship-cut">
                    <td colSpan={3 + events.length} className="border-y-2 border-dashed border-green-700 bg-green-100 py-2 text-sm font-bold text-green-900">
                      <span className="sticky left-0 px-3">Season Championship cut</span>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}
