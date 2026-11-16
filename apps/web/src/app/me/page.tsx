import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function MePage() {
  const { player } = await requireUser();
  return (
    <div>
      <h1 className="text-2xl font-bold">Me</h1>
      <p className="mt-2">{player.name}</p>
      <p className="text-slate-700">{player.email}</p>
    </div>
  );
}
