import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatRoundDate } from '@/lib/time';
import TeeSheetEditor, { type EditorGroup } from '@/components/TeeSheetEditor';
import PairingRules, { type RuleRow } from '@/components/PairingRules';
import { CHAMPIONS } from '@/lib/champions';
import { standingsBefore } from '@/lib/roundStandings';

export const dynamic = 'force-dynamic';

export default async function RoundGroupsPage({ params }: { params: Promise<{ id: string; roundId: string }> }) {
  await requireCommissioner();
  const { id, roundId } = await params;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(id) || !uuid.test(roundId)) notFound();
  // Service role (commissioner-only page): group codes are not readable with the user client.
  const admin = createAdminClient();

  const { data: round } = await admin
    .from('rounds')
    .select('id, event_id, round_number, play_date, tee_id')
    .eq('id', roundId)
    .eq('event_id', id)
    .maybeSingle();
  if (!round) notFound();

  const [{ data: event }, { data: regs }, { data: groups }, { data: ruleRows }, { data: roster }] = await Promise.all([
    admin.from('events').select('id, name, status, format, handicap_mode').eq('id', id).single(),
    admin.from('registrations').select('player_id').eq('event_id', id).eq('status', 'registered'),
    admin
      .from('groups')
      .select('id, code, tee_time, start_hole, scorer_player_id, scorer_device_token, locked, signed_at, created_at')
      .eq('round_id', roundId)
      .order('tee_time', { ascending: true, nullsFirst: false })
      .order('created_at'),
    admin.from('pairing_rules').select('id, player_a, player_b, kind'),
    admin.from('players').select('id, name').order('name'),
  ]);
  const rules: RuleRow[] = (ruleRows ?? []).map((r) => ({ id: r.id, a: r.player_a, b: r.player_b, kind: r.kind === 'apart' ? 'apart' : 'together' }));
  if (!event) notFound();
  const groupList = groups ?? [];
  const { data: members } = groupList.length
    ? await admin.from('group_players').select('group_id, player_id').in('group_id', groupList.map((g) => g.id))
    : { data: [] as { group_id: string; player_id: string }[] };

  const ids = [...new Set([...(regs ?? []).map((r) => r.player_id), ...(members ?? []).map((m) => m.player_id)])];
  const { data: players } = ids.length
    ? await admin.from('players').select('id, name, handicap_index').in('id', ids).order('name')
    : { data: [] as { id: string; name: string; handicap_index: number | null }[] };
  const registeredIds = new Set((regs ?? []).map((r) => r.player_id));
  // Past champions in the field (round 1 option), matched by name to the champions list.
  const champNames = new Set(CHAMPIONS.map((c) => c.champion.trim().toLowerCase()));
  const championIds = round.round_number === 1
    ? (players ?? []).filter((p) => registeredIds.has(p.id) && champNames.has(p.name.trim().toLowerCase())).map((p) => p.id)
    : [];
  // Later stroke rounds: standings so far, for "by standings, leaders last".
  const standings = round.round_number > 1 && event.format !== 'match_play'
    ? [...(await standingsBefore(admin, id, round.round_number, event.handicap_mode === 'gross' ? 'gross' : 'net')).values()]
    : null;

  const initialGroups: EditorGroup[] = groupList.map((g) => ({
    id: g.id,
    teeTime: g.tee_time ? String(g.tee_time).slice(0, 5) : '',
    startHole: g.start_hole,
    playerIds: (members ?? []).filter((m) => m.group_id === g.id).map((m) => m.player_id),
    scorerPlayerId: g.scorer_player_id,
    code: g.code,
    locked: g.locked || !!g.signed_at,
    scorerDeviceHeld: !!g.scorer_device_token,
  }));

  return (
    <div className="space-y-4">
      <Link href={`/admin/events/${id}`} className="inline-flex min-h-[44px] items-center text-green-800">
        ← {event.name}
      </Link>
      <h1 className="text-2xl font-bold">Round {round.round_number} groups</h1>
      <p className="text-gray-600">{formatRoundDate(round.play_date)} · times are Central</p>
      <TeeSheetEditor
        roundId={roundId}
        eventStatus={event.status}
        players={(players ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          registered: registeredIds.has(p.id),
          index: p.handicap_index === null ? null : Number(p.handicap_index),
        }))}
        initialGroups={initialGroups}
        rules={rules}
        championIds={championIds}
        standings={standings}
      />
      <PairingRules rules={rules} people={roster ?? []} />
    </div>
  );
}
