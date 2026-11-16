import Link from 'next/link';
import { requireCommissioner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireCommissioner();
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
    </div>
  );
}
