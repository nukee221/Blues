import Link from 'next/link';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireCommissioner();
  const supabase = await createServerClient();
  const { data: seasons } = await supabase.from('seasons').select('id, year').order('year', { ascending: false });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Admin</h1>
      <Link href="/admin/courses" className="flex min-h-[44px] items-center rounded border px-4 font-semibold">
        Courses
      </Link>
      <Link href="/admin/events" className="flex min-h-[44px] items-center rounded border px-4 font-semibold">
        Events
      </Link>
      <Link href="/admin/players" className="flex min-h-[44px] items-center rounded border px-4 font-semibold">
        Players
      </Link>
      {((seasons ?? []) as { id: string; year: number }[]).map((s) => (
        <Link key={s.id} href={`/admin/seasons/${s.id}/points`} className="flex min-h-[44px] items-center rounded border px-4 font-semibold">
          {s.year} points &amp; finalize
        </Link>
      ))}
    </div>
  );
}
