import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Results derive live from event settings and a tee's holes. Commissioners may correct them
 * after play (mistakes are found late), but a change that affects results already recorded
 * needs an explicit confirmation (`confirmResultsChange: true`) and is audited with before/after.
 *   - event: in_progress or final, and a results-affecting field changed;
 *   - tee: used by a round with a signed card, and rating/slope/par/a hole's par or SI changed.
 */

type Client = SupabaseClient;
type GroupRow = { id: string; round_id: string; locked: boolean; signed_at: string | null };

export const RESULTS_STATUSES = ['in_progress', 'final'] as const;

export const isSignedCard = (g: { locked: boolean; signed_at: string | null }) => g.locked || g.signed_at != null;

export type RoundRow = { id: string; round_number: number; tee_id: string; play_date: string | null; kind: 'stroke' | 'match' };

export async function loadEventRounds(client: Client, eventId: string): Promise<RoundRow[]> {
  const { data, error } = await client.from('rounds').select('id, round_number, tee_id, play_date, kind').eq('event_id', eventId);
  if (error) throw new Error(error.message);
  return (data ?? []) as RoundRow[];
}

/** Ids (of the given tees) used by a round that has a signed card. */
export async function signedTeeIds(client: Client, teeIds: string[]): Promise<Set<string>> {
  if (teeIds.length === 0) return new Set();
  const { data: rounds, error } = await client.from('rounds').select('id, tee_id').in('tee_id', teeIds);
  if (error) throw new Error(error.message);
  const rs = (rounds ?? []) as { id: string; tee_id: string }[];
  if (rs.length === 0) return new Set();
  const { data: groups, error: gErr } = await client
    .from('groups')
    .select('id, round_id, locked, signed_at')
    .in(
      'round_id',
      rs.map((r) => r.id),
    );
  if (gErr) throw new Error(gErr.message);
  const signedRounds = new Set(((groups ?? []) as GroupRow[]).filter(isSignedCard).map((g) => g.round_id));
  return new Set(rs.filter((r) => signedRounds.has(r.id)).map((r) => r.tee_id));
}
