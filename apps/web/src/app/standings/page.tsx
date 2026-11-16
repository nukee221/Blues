import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireUser();
  return <h1 className="text-2xl font-bold">Standings</h1>;
}
