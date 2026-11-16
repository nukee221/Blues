import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { getBracketView } from '@/actions/bracket';
import BracketAdmin from '@/components/BracketAdmin';

export const dynamic = 'force-dynamic';

export default async function AdminBracketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCommissioner();
  const { id } = await params;
  const result = await getBracketView(id);
  if (!result.ok) notFound();
  return (
    <div className="space-y-4">
      <Link href={`/admin/events/${id}`} className="inline-flex min-h-[44px] items-center text-green-800">
        ← {result.data.eventName}
      </Link>
      <h1 className="text-2xl font-bold">Match-play bracket</h1>
      <p className="text-gray-600">
        Times are Central ·{' '}
        <Link href={`/events/${id}/bracket`} className="underline">
          player view
        </Link>
      </p>
      <BracketAdmin view={result.data} />
    </div>
  );
}
