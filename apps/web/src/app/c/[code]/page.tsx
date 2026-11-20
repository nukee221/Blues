import Link from 'next/link';
import { redirect } from 'next/navigation';
import { openGroup } from '@/actions/scorecard';
import { normalizeCode } from '@/lib/codes';
import { SC } from '@/lib/scorecardCodes';
import RegisterServiceWorker from '../RegisterServiceWorker';
import Scorecard from './Scorecard';

export const dynamic = 'force-dynamic';

function Problem({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <h1 className="display text-5xl">Scorecard</h1>
      <p role="alert" className="text-xl font-semibold text-brandred-500">
        {message}
      </p>
      <Link href="/c" className="btn-gold min-h-[56px] px-6">
        Try another code
      </Link>
    </div>
  );
}

export default async function ScorecardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // leave as-is; normalizeCode rejects it
  }
  const code = normalizeCode(decoded);
  if (!code) return <Problem message="That is not a valid code." />;
  if (code !== raw) redirect(`/c/${code}`);

  const result = await openGroup(code);
  if (!result.ok) {
    return (
      <Problem
        message={result.code === SC.notFound ? 'No group has that code. Check your tee sheet email.' : result.error}
      />
    );
  }
  return (
    // data-hgt-card tells the service worker this is a real scorecard (safe to cache), not the "no group" page.
    <div data-hgt-card="1">
      <RegisterServiceWorker />
      <Scorecard code={code} initial={result.data} />
    </div>
  );
}
