import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ids of the event's per-match rounds (created by createMatchCard: one round per bracket
 * match). Pages that list an event's rounds (event page, leaderboard, admin) leave them out;
 * they are reached from the bracket. Works with the user client (RLS) or the service role.
 */
export async function bracketRoundIds(client: SupabaseClient, eventId: string): Promise<Set<string>> {
  const { data: bracket } = await client.from('brackets').select('id').eq('event_id', eventId).maybeSingle();
  if (!bracket) return new Set();
  const { data: matches } = await client.from('bracket_matches').select('group_id').eq('bracket_id', bracket.id);
  const groupIds = (matches ?? []).map((m) => m.group_id as string | null).filter((g): g is string => !!g);
  if (groupIds.length === 0) return new Set();
  const { data: groups } = await client.from('groups').select('round_id').in('id', groupIds);
  return new Set((groups ?? []).map((g) => g.round_id as string));
}

/**
 * The event's bracket matches that have a card and are still to be played, for the admin
 * Reminders box: round id, "Round 2, match 3", the two players' names.
 */
export async function openMatchRounds(client: SupabaseClient, eventId: string): Promise<{ roundId: string; label: string; players: string }[]> {
  const { data: bracket } = await client.from('brackets').select('id').eq('event_id', eventId).maybeSingle();
  if (!bracket) return [];
  const { data: matches } = await client.from('bracket_matches').select('match_key, group_id, result, forfeit').eq('bracket_id', bracket.id);
  const open = (matches ?? []).filter((m) => m.group_id && !m.result && !m.forfeit) as { match_key: string; group_id: string }[];
  if (open.length === 0) return [];
  const ids = open.map((m) => m.group_id);
  const [{ data: groups }, { data: members }] = await Promise.all([
    client.from('groups').select('id, round_id').in('id', ids),
    client.from('group_players').select('group_id, player_id').in('group_id', ids),
  ]);
  const pids = [...new Set((members ?? []).map((m) => m.player_id as string))];
  const { data: people } = pids.length ? await client.from('public_players').select('id, name').in('id', pids) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const roundOf = new Map(((groups ?? []) as { id: string; round_id: string }[]).map((g) => [g.id, g.round_id]));
  return open
    .filter((m) => roundOf.has(m.group_id))
    .map((m) => ({
      roundId: roundOf.get(m.group_id)!,
      label: m.match_key.replace(/^R(\d+)M(\d+)$/, 'Round $1, match $2'),
      players: (members ?? [])
        .filter((x) => x.group_id === m.group_id)
        .map((x) => nameOf.get(x.player_id as string) ?? 'Player')
        .join(' vs '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
