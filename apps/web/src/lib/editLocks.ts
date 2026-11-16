import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Edit locks that keep past results from changing under a commissioner's edit.
 *
 * A card is "signed" once it is locked or has signed_at (both signatures in). Readers
 * (leaderboards, cuts, match status, points recalculation) derive results live from the
 * event settings and the tee's holes, so once scoring has started those inputs freeze:
 *   - an event is locked while in_progress or final, or once any of its cards is signed;
 *   - a tee is locked once a round on it has a signed card (add a new tee instead).
 * The DB mirrors the tee lock for signed-in sessions (0008_edit_locks.sql).
 */

type Client = SupabaseClient;
type GroupRow = { id: string; round_id: string; locked: boolean; signed_at: string | null };

export const LOCKED_EVENT_STATUSES = ['in_progress', 'final'] as const;

export const isSignedCard = (g: { locked: boolean; signed_at: string | null }) => g.locked || g.signed_at != null;

export type RoundRow = { id: string; round_number: number; tee_id: string; play_date: string | null; kind: 'stroke' | 'match' };

export type EventLockState = {
  rounds: RoundRow[];
  /** Ids of rounds that have at least one group. */
  roundsWithGroups: Set<string>;
  anySignedCard: boolean;
};

/** Rounds of an event, which have groups, and whether any card is signed. */
export async function loadEventLockState(client: Client, eventId: string): Promise<EventLockState> {
  const { data: rounds, error } = await client
    .from('rounds')
    .select('id, round_number, tee_id, play_date, kind')
    .eq('event_id', eventId);
  if (error) throw new Error(error.message);
  const list = (rounds ?? []) as RoundRow[];
  if (list.length === 0) return { rounds: [], roundsWithGroups: new Set(), anySignedCard: false };
  const { data: groups, error: gErr } = await client
    .from('groups')
    .select('id, round_id, locked, signed_at')
    .in(
      'round_id',
      list.map((r) => r.id),
    );
  if (gErr) throw new Error(gErr.message);
  const gs = (groups ?? []) as GroupRow[];
  return {
    rounds: list,
    roundsWithGroups: new Set(gs.map((g) => g.round_id)),
    anySignedCard: gs.some(isSignedCard),
  };
}

export function eventIsLocked(status: string, state: Pick<EventLockState, 'anySignedCard'>): boolean {
  return (LOCKED_EVENT_STATUSES as readonly string[]).includes(status) || state.anySignedCard;
}

/** Ids (of the given tees) used by a round that has a signed card. */
export async function lockedTeeIds(client: Client, teeIds: string[]): Promise<Set<string>> {
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
