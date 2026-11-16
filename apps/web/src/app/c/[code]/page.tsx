import Link from 'next/link';
import { redirect } from 'next/navigation';
import { openGroup, type GroupView } from '@/actions/scorecard';
import { normalizeCode } from '@/lib/codes';
import Scorecard from './Scorecard';

export const dynamic = 'force-dynamic';

function Problem({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Scorecard</h1>
      <p role="alert" className="text-xl font-semibold text-red-800">
        {message}
      </p>
      <Link href="/c" className="inline-flex min-h-[56px] items-center rounded bg-slate-900 px-6 text-xl font-bold text-white">
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

  let view: GroupView;
  try {
    view = await openGroup(code);
  } catch (e) {
    if (e instanceof Error && e.message === 'No group has that code') {
      return <Problem message="No group has that code. Check your tee sheet email." />;
    }
    throw e;
  }
  return <Scorecard code={code} initial={view} />;
}
