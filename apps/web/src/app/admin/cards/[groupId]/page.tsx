import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadCard } from '@/lib/cardData';
import { formatCentral, formatTeeTime } from '@/lib/time';
import CardAdmin from '@/components/CardAdmin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CardAdminPage({ params }: { params: Promise<{ groupId: string }> }) {
  await requireCommissioner();
  const { groupId } = await params;
  if (!UUID.test(groupId)) notFound();
  // Service role (commissioner-only page): signatures, scores and audit rows in one read path.
  const admin = createAdminClient();
  const { data: group } = await admin
    .from('groups')
    .select('id, round_id, start_hole, tee_time, scorer_player_id, locked, signed_at')
    .eq('id', groupId)
    .maybeSingle();
  if (!group) notFound();
  const card = await loadCard(admin, group);
  const { data: rounds } = await admin.from('rounds').select('play_date').eq('id', group.round_id).maybeSingle();

  const [{ data: groupAudit }, { data: scoreAudit }] = await Promise.all([
    admin.from('audit_log').select('id, at, entity, before, after, actor_player_id').eq('entity_id', groupId).order('at', { ascending: false }).limit(20),
    admin
      .from('audit_log')
      .select('id, at, entity, before, after, actor_player_id')
      .eq('entity', 'score')
      .eq('after->>group_id', groupId)
      .order('at', { ascending: false })
      .limit(50),
  ]);
  const audit = [...(groupAudit ?? []), ...(scoreAudit ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const actorIds = [...new Set(audit.map((a) => a.actor_player_id).filter((x): x is string => !!x))];
  const { data: actors } = actorIds.length
    ? await admin.from('players').select('id, name').in('id', actorIds)
    : { data: [] as { id: string; name: string }[] };
  const actorName = new Map((actors ?? []).map((p) => [p.id, p.name]));
  const playerName = new Map(card.players.map((p) => [p.id, p.name]));

  function describe(a: (typeof audit)[number]): string {
    const after = (a.after ?? {}) as Record<string, unknown>;
    const before = (a.before ?? {}) as Record<string, unknown>;
    if (a.entity === 'score') {
      const who = playerName.get(String(after.player_id)) ?? 'Player';
      return `Score: ${who} hole ${after.hole}: ${before.gross ?? '–'} → ${after.gross}`;
    }
    if (a.entity === 'signature') {
      return `Signed for ${playerName.get(String(after.player_id)) ?? 'player'} as ${after.role}`;
    }
    if (after.action === 'reopen') return `Reopened: ${String(after.reason ?? '')}`;
    if (after.action === 'withdraw') {
      const who = playerName.get(String(after.player_id)) ?? 'Player';
      return after.withdrawn ? `${who} marked withdrawn (WD)` : `${who} reinstated (WD undone)`;
    }
    return 'Scorer phone freed';
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/admin/events/${card.round.event_id}/rounds/${card.round.id}`}
        className="inline-flex min-h-[44px] items-center text-green-800"
      >
        ← Round {card.round.round_number} groups
      </Link>
      <h1 className="text-2xl font-bold">
        {card.event.name} · Round {card.round.round_number}
      </h1>
      <p className="text-gray-700">
        {card.players.map((p) => p.name).join(', ')} · tee {formatTeeTime(rounds?.play_date ?? null, group.tee_time)} · start hole{' '}
        {group.start_hole} · {card.round.kind === 'match' ? 'match play' : 'stroke play'}
      </p>
      <CardAdmin
        groupId={groupId}
        locked={group.locked || !!group.signed_at}
        signedAt={group.signed_at}
        scorerPlayerId={group.scorer_player_id}
        kind={card.round.kind}
        players={card.players}
        holes={card.holes}
        scores={card.scores}
        signatures={card.signatures}
        startHole={group.start_hole}
        matchStrokes={card.event.matchStrokes}
      />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        {audit.length === 0 ? (
          <p className="text-gray-600">No commissioner changes.</p>
        ) : (
          <ul className="space-y-1">
            {audit.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="font-semibold">{formatCentral(String(a.at))}</span> · {actorName.get(a.actor_player_id ?? '') ?? 'Commissioner'} ·{' '}
                {describe(a)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
