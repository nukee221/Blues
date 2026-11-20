'use client';
import { Avatar } from '@/components/Avatar';
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
  const active = rows.filter((r) => !r.withdrawn);
  const projected = active.some((r) => r.thru < 18);
  const lineAfter = cutLine !== null && active.length > cutLine ? cutLine : null;
  const net = mode === 'net';

  return (
    <div>
      <p className="mb-2 text-sm text-silver-300">
        {net ? 'Net' : 'Gross'} stroke play · updates live{stale ? ' · connection lost, retrying' : ''}
      </p>
      {rows.length === 0 ? (
        <p className="text-silver-300">No players in this round yet.</p>
      ) : (
        <div className="-mx-5 border-y border-white/10">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="border-b-2 border-gold-400/70 bg-navy-950 text-left font-label text-xs font-semibold uppercase tracking-wider text-silver-300">
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2">Player</th>
              <th className="px-1.5 py-2 text-right">Thru</th>
              <th className="whitespace-nowrap px-1.5 py-2 text-right">{net ? 'Net' : 'To par'}</th>
              <th className="px-1.5 py-2 text-right">Gross</th>
              <th className="w-6 px-1 py-2 text-center"><span className="sr-only">Signed</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <RowWithCut key={r.playerId} showLine={lineAfter === i} n={cutLine} projected={projected}>
                <tr className={`min-h-[44px] border-b border-white/10 ${r.advancing ? 'bg-navy-600' : i % 2 ? 'bg-navy-900' : 'bg-navy-800'}`}>
                  <td className="display px-2 py-3 text-2xl">
                    <span className={!r.withdrawn && r.thru > 0 && (r.advancing || r.position <= 3) ? 'text-gold-grad' : 'text-silver-300'}>
                      {r.withdrawn ? 'WD' : r.thru === 0 ? '-' : formatPos(r.position, r.tied)}
                    </span>
                  </td>
                  <td className="w-full max-w-0 px-2 py-2 font-semibold text-white">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar playerId={r.playerId} name={r.name} photoVersion={r.photoVersion} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {r.name}
                          {r.advancing && <span className="ml-2 rounded bg-gold-400 px-1.5 py-0.5 font-label text-xs font-bold uppercase tracking-wider text-navy-950">Advancing</span>}
                        </span>
                        {r.homeClub && <span className="block truncate text-xs font-normal text-silver-400">{r.homeClub}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-1.5 py-3 text-right tabular-nums text-silver-300">{formatThru(r.thru)}</td>
                  <td className={`px-1.5 py-3 text-right text-lg font-bold tabular-nums ${r.thru > 0 && r.toPar < 0 ? 'text-gold-400' : 'text-white'}`}>{r.thru === 0 ? '-' : formatToPar(r.toPar)}</td>
                  <td className="px-1.5 py-3 text-right tabular-nums text-silver-300">{r.thru === 0 ? '-' : r.gross}</td>
                  <td className="w-6 px-1 py-3 text-center font-bold text-gold-400" aria-label={r.signed ? 'Card signed' : undefined}>{r.signed ? '✓' : ''}</td>
                </tr>
              </RowWithCut>
            ))}
          </tbody>
        </table>
        </div>
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
          <td colSpan={6} className="eyebrow border-y-2 border-dashed border-gold-400 bg-navy-950 px-2 py-2 text-center text-gold-400">
            Top {n} advance{projected ? ' (projected)' : ''}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
