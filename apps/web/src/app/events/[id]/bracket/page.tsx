import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getBracketView } from '@/actions/bracket';
import BracketLive from './BracketLive';

export const dynamic = 'force-dynamic';

export default async function BracketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const result = await getBracketView(id);
  if (!result.ok) notFound();
  // User client: tees are reference data every player may read.
  const supabase = await createServerClient();
  const { data: tees } = await supabase.from('tees').select('id, name, courses(name)').order('name');
  const teeOptions = (tees ?? []).map((t) => ({
    id: t.id as string,
    label: `${(t.courses as unknown as { name: string } | null)?.name ?? 'Course'} – ${t.name}`,
  }));
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/events/${id}`} className="inline-flex min-h-[44px] items-center text-sm text-silver-300 underline-offset-2 hover:underline">
          ← Back to event
        </Link>
        <p className="eyebrow text-gold-400">Match-play bracket</p>
        <h1 className="display mt-2 text-4xl">{result.data.eventName}</h1>
      </div>
      <BracketLive eventId={id} initial={result.data} tees={teeOptions} />
    </div>
  );
}
