'use server';
import { z } from 'zod';
import { advanceCount, playInCut, type LeaderboardRow } from '@hgt/scoring';
import { requireUser } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { getTeeInfo } from '@/lib/courses';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { playInBoard } from '@/lib/playIn';

export type BoardRow = LeaderboardRow & {
  name: string;
  /** The player's group has locked its card (both signatures in). */
  signed: boolean;
  /** Inside the play-in cut, set only once every player has finished 18. */
  advancing: boolean;
  /** Withdrawn / no-show (WD): listed last, position 0 (none), never advancing. */
  withdrawn: boolean;
};
export type RoundLeaderboard = {
  rows: BoardRow[];
  /** Spots that advance (match-play round 1 only), else null. */
  cutLine: number | null;
  eventName: string;
  roundNumber: number;
  mode: 'gross' | 'net';
};

const uuid = z.string().uuid('Invalid id');
const HOLES = 18;

/**
 * Standings for one round. Reads with the signed-in user's client, so RLS hides rounds of
 * draft events (-> 'not_found'); never touches groups.code or players.pin_hash.
 * Cards cover holes 1-18 only; extra (tiebreak) holes are ignored. Withdrawn players (WD,
 * group_players.withdrawn) are listed after everyone else with no position.
 */
export async function getRoundLeaderboard(roundId: string): Promise<ActionResult<RoundLeaderboard>> {
  await requireUser();
  return toResult(async () => {
    const id = uuid.parse(roundId);
    const supabase = await createServerClient();
    const notFound = new ActionError(ACT.notFound, 'Round not found');

    const { data: round, error: rErr } = await supabase
      .from('rounds')
      .select('id, event_id, round_number, tee_id')
      .eq('id', id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!round) throw notFound;
    const { data: event, error: eErr } = await supabase
      .from('events')
      .select('id, name, format, status, handicap_mode')
      .eq('id', round.event_id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!event || event.status === 'draft') throw notFound;
    const mode: 'gross' | 'net' = event.handicap_mode === 'net' ? 'net' : 'gross';

    const { data: groups, error: gErr } = await supabase.from('groups').select('id, locked').eq('round_id', id);
    if (gErr) throw new Error(gErr.message);
    const groupIds = (groups ?? []).map((g) => g.id as string);
    const lockedGroups = new Set((groups ?? []).filter((g) => g.locked).map((g) => g.id as string));

    const [gpRes, scRes] = groupIds.length
      ? await Promise.all([
          supabase.from('group_players').select('group_id, player_id, playing_handicap, withdrawn').in('group_id', groupIds),
          supabase.from('scores').select('group_id, player_id, hole, gross').in('group_id', groupIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (gpRes.error) throw new Error(gpRes.error.message);
    if (scRes.error) throw new Error(scRes.error.message);
    const members = (gpRes.data ?? []) as { group_id: string; player_id: string; playing_handicap: number | null; withdrawn?: boolean | null }[];
    const scores = (scRes.data ?? []) as { player_id: string; hole: number; gross: number | null }[];

    const playerIds = members.map((m) => m.player_id);
    const { data: names, error: nErr } = playerIds.length
      ? await supabase.from('public_players').select('id, name').in('id', playerIds)
      : { data: [] as { id: string; name: string }[], error: null };
    if (nErr) throw new Error(nErr.message);
    const nameOf = new Map((names ?? []).map((p) => [p.id as string, p.name as string]));

    const tee = await getTeeInfo(round.tee_id);
    const { board, withdrawn } = playInBoard(members, scores, tee, mode);

    let cutLine: number | null = null;
    if (event.format === 'match_play' && round.round_number === 1) {
      const { data: regs, error: cErr } = await supabase
        .from('registrations')
        .select('player_id')
        .eq('event_id', event.id)
        .eq('status', 'registered');
      if (cErr) throw new Error(cErr.message);
      cutLine = advanceCount((regs ?? []).length);
    }
    const finished = board.filter((r) => r.thru === HOLES);
    const advanced = new Set(
      cutLine !== null && board.length > 0 && finished.length === board.length ? playInCut(finished, cutLine).advanced : [],
    );

    const groupOf = new Map(members.map((m) => [m.player_id, m.group_id]));
    const row = (r: LeaderboardRow, wd: boolean): BoardRow => ({
      ...r,
      name: nameOf.get(r.playerId) ?? 'Unknown player',
      signed: lockedGroups.has(groupOf.get(r.playerId) ?? ''),
      advancing: !wd && advanced.has(r.playerId),
      withdrawn: wd,
    });
    const rows: BoardRow[] = [...board.map((r) => row(r, false)), ...withdrawn.map((r) => row(r, true))];
    return { rows, cutLine, eventName: event.name as string, roundNumber: round.round_number as number, mode };
  });
}
