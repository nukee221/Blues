'use client';
import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/browser';
import { getRoundLeaderboard, type RoundLeaderboard } from '@/actions/leaderboard';
import { formatPos, formatThru, formatToPar } from '@/lib/leaderboardFormat';
import { throttle } from '@/lib/throttle';

const THROTTLE_MS = 2000; // at most one re-query per 2 s
const POLL_MS = 20_000; // fallback when realtime is unavailable

export default function Live({ roundId, initial }: { roundId: string; initial: RoundLeaderboard }) {
  const [board, setBoard] = useState(initial);
  const [stale, setStale] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      if (inflight.current) return;
      inflight.current = true;
      try {
        const r = await getRoundLeaderboard(roundId);
        if (!alive) return;
        if (r.ok) {
          setBoard(r.data);
          setStale(false);
        } else setStale(true);
      } catch {
        if (alive) setStale(true);
      } finally {
        inflight.current = false;
      }
    }
    const throttled = throttle(() => void refresh(), THROTTLE_MS);
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`leaderboard-${roundId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, () => throttled.call())
      .subscribe();
    const poll = setInterval(() => throttled.call(), POLL_MS);
    return () => {
      alive = false;
      throttled.cancel();
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [roundId]);

  const { rows, cutLine, mode } = board;
  const projected = rows.some((r) => r.thru < 18);
  const lineAfter = cutLine !== null && rows.length > cutLine ? cutLine : null;
  const net = mode === 'net';

  return (
    <div>
      <p className="mb-2 text-sm text-gray-700">
        {net ? 'Net' : 'Gross'} stroke play · updates live{stale ? ' · connection lost, retrying' : ''}
      </p>
      {rows.length === 0 ? (
        <p className="text-gray-700">No players in this round yet.</p>
      ) : (
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="border-b-2 border-gray-900 text-left text-sm uppercase">
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2">Player</th>
              <th className="px-2 py-2 text-right">Thru</th>
              <th className="px-2 py-2 text-right">{net ? 'Net' : 'To par'}</th>
              <th className="px-2 py-2 text-right">Gross</th>
              <th className="px-2 py-2 text-center"><span className="sr-only">Signed</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <RowWithCut key={r.playerId} showLine={lineAfter === i} n={cutLine} projected={projected}>
                <tr className={`min-h-[44px] border-b border-gray-300 ${r.advancing ? 'bg-green-50' : ''}`}>
                  <td className="px-2 py-3 font-semibold">{r.thru === 0 ? '-' : formatPos(r.position, r.tied)}</td>
                  <td className="px-2 py-3 font-medium">
                    {r.name}
                    {r.advancing && <span className="ml-2 rounded bg-green-700 px-1.5 py-0.5 text-xs font-semibold text-white">Advancing</span>}
                  </td>
                  <td className="px-2 py-3 text-right">{formatThru(r.thru)}</td>
                  <td className="px-2 py-3 text-right text-lg font-bold">{r.thru === 0 ? '-' : formatToPar(r.toPar)}</td>
                  <td className="px-2 py-3 text-right">{r.thru === 0 ? '-' : r.gross}</td>
                  <td className="px-2 py-3 text-center" aria-label={r.signed ? 'Card signed' : undefined}>{r.signed ? '✓' : ''}</td>
                </tr>
              </RowWithCut>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Renders the cut-line row (above the child row's table row) when `showLine`. */
function RowWithCut({ showLine, n, projected, children }: { showLine: boolean; n: number | null; projected: boolean; children: React.ReactNode }) {
  return (
    <>
      {showLine && (
        <tr data-testid="cut-line">
          <td colSpan={6} className="border-y-2 border-dashed border-green-700 bg-green-100 px-2 py-2 text-center text-sm font-bold text-green-900">
            Top {n} advance{projected ? ' (projected)' : ''}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
