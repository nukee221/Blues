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
