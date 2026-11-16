import Link from 'next/link';
import { requireCommissioner } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  await requireCommissioner();
  const supabase = await createServerClient();
  const { data: courses } = await supabase
    .from('courses')
    .select('id, name, tees(id, name, rating, slope, par)')
    .order('name');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Courses</h1>
      <Link href="/admin/courses/new" className="flex min-h-[44px] items-center justify-center rounded bg-green-700 px-4 font-semibold text-white">
        Add course
      </Link>
      <ul className="space-y-2">
        {(courses ?? []).map((c) => (
          <li key={c.id}>
            <Link href={`/admin/courses/${c.id}`} className="block min-h-[44px] rounded border p-3">
              <div className="font-semibold">{c.name}</div>
              <div className="text-sm text-gray-600">
                {c.tees.length === 0
                  ? 'No tees'
                  : c.tees.map((t) => `${t.name} ${Number(t.rating)}/${t.slope} par ${t.par}`).join(' · ')}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
