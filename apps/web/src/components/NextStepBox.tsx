import Link from 'next/link';
import type { SetupStep } from '@/lib/eventSetup';
import type { DayCounts } from '@/lib/eventDay';
import LiveRefresh from '@/components/LiveRefresh';

function Count({ label, n, of }: { label: string; n: number; of: number }) {
  const full = of > 0 && n === of;
  return (
    <div className="rounded border bg-white px-2 py-2 text-center">
      <div className={`text-2xl font-bold tabular-nums ${full ? 'text-green-700' : 'text-gray-900'}`}>
        {n}
        <span className="text-base font-semibold text-gray-500"> of {of}</span>
      </div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</div>
    </div>
  );
}

/** The event page's "next step" box: what to do now, and on event day live counts for the round. */
export default function NextStepBox({ next: step, counts }: { next: SetupStep | undefined; counts: DayCounts | null }) {
  // While rounds are still being played, finalizing is not the next thing to do yet.
  const waiting = !!counts && step?.key === 'finalize' && !counts.allSigned;
  const next = waiting ? undefined : step;
  const go = next && (next.href.startsWith('#') ? (
    <a href={next.href} className="flex min-h-[44px] items-center justify-center rounded bg-red-700 px-4 font-semibold text-white">
      {next.label} →
    </a>
  ) : (
    <Link href={next.href} className="flex min-h-[44px] items-center justify-center rounded bg-red-700 px-4 font-semibold text-white">
      {next.label} →
    </Link>
  ));
  return (
    <section aria-labelledby="next-heading" className="space-y-3 rounded border-2 border-red-200 bg-red-50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="next-heading" className="text-lg font-semibold">
          {counts ? `Round ${counts.roundNumber} live` : step ? 'Next step' : 'All done'}
        </h2>
        {counts && <span className="text-xs text-gray-600">Updates every 30 seconds</span>}
      </div>
      {counts && (
        <>
          <LiveRefresh seconds={30} />
          <div className="grid grid-cols-3 gap-2">
            <Count label="Groups joined" n={counts.joined} of={counts.total} />
            <Count label="Started scoring" n={counts.scoring} of={counts.total} />
            <Count label="Cards signed" n={counts.signed} of={counts.total} />
          </div>
          {counts.allSigned && <p className="text-sm font-semibold text-green-800">Every card is signed.</p>}
          {waiting && <p className="text-sm text-gray-800">Finalize once every card is signed.</p>}
        </>
      )}
      {next ? (
        <div className="space-y-2">
          {!counts && <p className="text-gray-800">{next.detail}</p>}
          {counts && <p className="text-sm text-gray-800">Next: {next.label.toLowerCase()} · {next.detail}</p>}
          {go}
        </div>
      ) : (
        !step && <p className="text-gray-800">The event is final and its points are on the standings.</p>
      )}
    </section>
  );
}
