import { requireCommissioner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireCommissioner();
  return <h1 className="text-2xl font-bold">Admin</h1>;
}
