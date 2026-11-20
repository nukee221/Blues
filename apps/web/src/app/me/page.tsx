import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { formatHandicap } from '@/lib/handicapFormat';
import ProfileForm from './ProfileForm';

export const dynamic = 'force-dynamic';

export default async function MePage() {
  const { player } = await requireUser();
  return (
    <div className="space-y-6">
      <p className="eyebrow text-gold-400">Your profile</p>
      <div className="flex items-center gap-4">
        <Avatar playerId={player.id} name={player.name} photoVersion={player.photo_version} size={96} />
        <div className="min-w-0">
          <h1 className="display text-4xl">Me</h1>
          <p className="mt-1 truncate text-lg font-semibold">{player.name}</p>
          <p className="truncate text-sm text-silver-300">{player.email}</p>
          <p className="text-sm text-silver-300">
            Index <span className="font-semibold text-white">{formatHandicap(player.handicap_index)}</span>
            {player.home_club && <> · {player.home_club}</>}
          </p>
        </div>
      </div>

      <section className="card-dark space-y-3 p-4">
        <h2 className="eyebrow text-silver-300">Photo and club</h2>
        <p className="text-sm text-silver-300">Shown next to your name on the standings and leaderboards.</p>
        <ProfileForm homeClub={player.home_club} hasPhoto={player.photo_version > 0} />
      </section>

      <Link href="/me/pin" className="card-dark flex min-h-[56px] items-center justify-between px-4 font-semibold">
        <span>PIN for signing cards</span>
        <span className="text-gold-400">{player.has_pin ? 'Change' : 'Set PIN'} →</span>
      </Link>
    </div>
  );
}
