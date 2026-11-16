import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import PlayersAdmin, { type PlayerListItem } from '@/components/PlayersAdmin';

export const dynamic = 'force-dynamic';

export default async function PlayersPage() {
  await requireCommissioner();
  // Admin client: other players' emails are not readable via RLS. Safe because commissioner is verified above.
  const { data, error } = await createAdminClient()
    .from('players')
    .select('id, name, email, handicap_index, handicap_source, is_commissioner')
    .order('name');
  if (error) throw new Error(error.message);
  const players = ((data ?? []) as (Omit<PlayerListItem, 'handicap_index'> & { handicap_index: number | string | null })[]).map(
    (p) => ({ ...p, handicap_index: p.handicap_index === null ? null : Number(p.handicap_index) }),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Players</h1>
      <PlayersAdmin players={players} />
    </div>
  );
}
