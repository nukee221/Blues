import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTeeInfo } from '@/lib/courses';
import { playInBoard, type PlayInMember, type PlayInScore } from '@/lib/playIn';
import type { StandingEntry } from '@/lib/groups';
import { allRows } from '@/lib/allRows';
import { centralInputToIso } from '@/lib/time';

/**
 * Standings going into round `roundNumber`: each player's score to par over the event's
 * earlier rounds, and when their card in the round just before was finished (signed, or the
 * group's tee time if never signed) for "first in, last out" ties. Service role only.
 */
export async function standingsBefore(
  admin: SupabaseClient,
  eventId: string,
  roundNumber: number,
  mode: 'gross' | 'net',
): Promise<Map<string, StandingEntry>> {
  const out = new Map<string, StandingEntry>();
  if (roundNumber <= 1) return out;
  const { data: rounds } = await admin
    .from('rounds')
    .select('id, round_number, tee_id, play_date, kind')
    .eq('event_id', eventId)
    .eq('kind', 'stroke')
    .lt('round_number', roundNumber);
  for (const r of rounds ?? []) {
    const { data: groups } = await admin.from('groups').select('id, tee_time, signed_at').eq('round_id', r.id);
    const list = (groups ?? []) as { id: string; tee_time: string | null; signed_at: string | null }[];
    if (list.length === 0) continue;
    const ids = list.map((g) => g.id);
    const [{ data: members }, scores] = await Promise.all([
      admin.from('group_players').select('group_id, player_id, playing_handicap, withdrawn').in('group_id', ids),
      allRows((from, to) => admin.from('scores').select('player_id, hole, gross').in('group_id', ids).order('id').range(from, to)),
    ]);
    const tee = await getTeeInfo(r.tee_id, admin);
    const { board } = playInBoard((members ?? []) as PlayInMember[], (scores ?? []) as PlayInScore[], tee, mode);
    const groupOf = new Map(((members ?? []) as { group_id: string; player_id: string }[]).map((m) => [m.player_id, m.group_id]));
    const finished = new Map(
      // never signed: its tee time (Central wall clock) stands in for the finish
      list.map((g) => [g.id, g.signed_at ?? ((g.tee_time && r.play_date && centralInputToIso(`${r.play_date}T${String(g.tee_time).slice(0, 5)}`)) || null)]),
    );
    const last = r.round_number === roundNumber - 1;
    for (const row of board) {
      if (row.thru === 0) continue;
      const prev = out.get(row.playerId);
      out.set(row.playerId, {
        id: row.playerId,
        toPar: (prev?.toPar ?? 0) + row.toPar,
        finishedAt: last ? (finished.get(groupOf.get(row.playerId) ?? '') ?? null) : (prev?.finishedAt ?? null),
      });
    }
  }
  return out;
}
