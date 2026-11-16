import Link from 'next/link';
import { Fragment } from 'react';
import type { StandingsEntry } from '@/actions/points';
import { formatPos } from '@/lib/leaderboardFormat';
import { formatPoints } from '@/lib/standings';

/**
 * Season standings: Pos (T on ties), Player, Points (2 decimals), Events. A labelled line runs
 * under the last qualifier (8th, or everyone tied at 8th). The viewer's own row is highlighted;
 * each name opens the player's per-event breakdown.
 */
export default function StandingsTable({ rows, me, seasonId }: { rows: StandingsEntry[]; me: string; seasonId?: string }) {
  if (rows.length === 0) return <p className="text-gray-700">No points awarded yet this season.</p>;
  const lastQualified = rows.reduce((at, r, i) => (r.qualified ? i : at), -1);
  const q = seasonId ? `?season=${seasonId}` : '';
  return (
    <table className="w-full border-collapse text-base">
      <thead>
        <tr className="border-b-2 border-gray-900 text-left text-sm uppercase">
          <th className="px-2 py-2">Pos</th>
          <th className="px-2 py-2">Player</th>
          <th className="px-2 py-2 text-right">Points</th>
          <th className="px-2 py-2 text-right">Events</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const mine = r.playerId === me;
          return (
            <Fragment key={r.playerId}>
              <tr className={`border-b border-gray-300 ${mine ? 'bg-yellow-100 font-semibold' : ''}`} aria-current={mine ? 'true' : undefined}>
                <td className="px-2 font-semibold">{formatPos(r.position, r.tied)}</td>
                <td className="px-2">
                  <Link href={`/standings/${r.playerId}${q}`} className="flex min-h-[44px] items-center font-medium text-green-900 underline-offset-2 hover:underline">
                    {r.name}
                    {mine && <span className="ml-2 rounded bg-yellow-500 px-1.5 text-xs font-bold text-black">You</span>}
                  </Link>
                </td>
                <td className="px-2 text-right text-lg font-bold tabular-nums">{formatPoints(r.total)}</td>
                <td className="px-2 text-right tabular-nums">{r.eventsPlayed}</td>
              </tr>
              {i === lastQualified && (
                <tr data-testid="championship-cut">
                  <td colSpan={4} className="border-y-2 border-dashed border-green-700 bg-green-100 px-2 py-2 text-center text-sm font-bold text-green-900">
                    Season Championship cut
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
