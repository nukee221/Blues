import Link from 'next/link';
import type { SetupStep } from '@/lib/eventSetup';

/** Guided event setup: numbered steps, a check mark on each one done, the next one highlighted. */
export default function SetupSteps({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((s) => s.state === 'done').length;
  return (
    <section aria-labelledby="setup-heading" className="space-y-3 rounded border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="setup-heading" className="text-lg font-semibold">Event setup</h2>
        <span className="text-sm text-gray-700">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const done = s.state === 'done';
          const current = s.state === 'current';
          const anchor = s.href.startsWith('#');
          const body = (
            <>
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  done ? 'bg-green-700 text-white' : current ? 'border-2 border-red-700 text-red-700' : 'border-2 border-gray-300 text-gray-500'
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${done ? 'text-gray-700' : current ? 'text-gray-900' : 'text-gray-500'}`}>
                  {s.label}
                  <span className="sr-only">{done ? ' (done)' : current ? ' (next step)' : ' (to do)'}</span>
                </span>
                {s.detail && <span className="block text-sm text-gray-600">{s.detail}</span>}
              </span>
              {current && <span className="shrink-0 text-sm font-semibold text-red-700">Next →</span>}
            </>
          );
          const cls = `flex min-h-[44px] items-center gap-3 rounded px-2 py-1 ${current ? 'bg-red-50 ring-1 ring-red-200' : ''}`;
          return (
            <li key={s.key} aria-current={current ? 'step' : undefined}>
              {current || !done ? (
                anchor ? (
                  <a href={s.href} className={cls}>{body}</a>
                ) : (
                  <Link href={s.href} className={cls}>{body}</Link>
                )
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
