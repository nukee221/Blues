import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function MePage() {
  const { player } = await requireUser();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Me</h1>
        <p className="mt-2">{player.name}</p>
        <p className="text-slate-700">{player.email}</p>
      </div>
      <Link
        href="/me/pin"
        className="flex min-h-[56px] items-center justify-between rounded border-2 border-slate-900 px-4 text-lg font-semibold"
      >
        <span>PIN for signing cards</span>
        <span>{player.has_pin ? 'Change' : 'Set PIN'} →</span>
      </Link>
    </div>
  );
}
