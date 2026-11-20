import Link from 'next/link';
import type { EventRow } from '@/lib/eventCards';
import { formatShortDate } from '@/lib/time';

/** One event as a row from the season poster: gold number, logo, name, details, DATE on the right. */
export function EventRowCard({ row, compact = false }: { row: EventRow; compact?: boolean }) {
  return (
    <Link href={`/events/${row.id}`} className="row-card flex min-h-[88px] items-stretch overflow-hidden">
      {!compact && (
        <span className="display flex w-12 shrink-0 items-center justify-center text-3xl">
          <span className="text-gold-grad">{row.number}</span>
        </span>
      )}
      <span className={`flex shrink-0 items-center justify-center bg-white ${compact ? 'w-16' : 'w-[76px]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
        <img src={row.logo} alt="" width={64} height={64} className="h-16 w-16 object-contain" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
        <span className="display block text-2xl text-white">{row.name}</span>
        <span className="mt-1 block text-sm text-silver-300">{row.detail}</span>
        {row.course && <span className="block truncate text-xs text-silver-300">{row.course}</span>}
        {row.defending && (
          <span className="mt-0.5 block text-xs leading-snug text-silver-400">
            Defending: <span className="font-semibold text-gold-400">{row.defending.champion}</span>
          </span>
        )}
      </span>
      <span className="flex w-16 shrink-0 flex-col items-center justify-center border-l border-white/10 text-center">
        <span className="eyebrow text-[9px] tracking-[0.2em] text-silver-400">{row.status === 'final' ? 'Played' : 'Date'}</span>
        <span className="display mt-0.5 text-lg text-white">{row.date ? formatShortDate(row.date) : 'TBA'}</span>
      </span>
    </Link>
  );
}
