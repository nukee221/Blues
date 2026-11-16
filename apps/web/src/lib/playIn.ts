import { strokePlayLeaderboard, type LeaderboardRow, type PlayerCard, type TeeInfo } from '@hgt/scoring';

/** A play-in group member as stored (group_players). */
export type PlayInMember = { player_id: string; playing_handicap: number | null; withdrawn?: boolean | null };
export type PlayInScore = { player_id: string; hole: number; gross: number | null };

const HOLES = 18;

/** Gross per hole (index = hole - 1) for each member; extra (match) holes 19+ are ignored. */
export function playInCards(members: PlayInMember[], scores: PlayInScore[]): PlayerCard[] {
  const grossBy = new Map<string, (number | null)[]>();
  for (const m of members) grossBy.set(m.player_id, Array<number | null>(HOLES).fill(null));
  for (const s of scores) {
    if (s.hole < 1 || s.hole > HOLES) continue;
    const card = grossBy.get(s.player_id);
    if (card) card[s.hole - 1] = s.gross;
  }
  return members.map((m) => ({ playerId: m.player_id, playing: m.playing_handicap ?? 0, gross: grossBy.get(m.player_id)! }));
}

/**
 * Stroke-play standings of a round: `board` ranks the players still in; `withdrawn` (WD)
 * players are ranked separately and carry position 0 (no position): they are listed last
 * and never make the play-in cut.
 */
export function playInBoard(
  members: PlayInMember[],
  scores: PlayInScore[],
  tee: TeeInfo,
  mode: 'gross' | 'net',
): { board: LeaderboardRow[]; withdrawn: LeaderboardRow[] } {
  const cards = playInCards(members, scores);
  const out = new Set(members.filter((m) => m.withdrawn).map((m) => m.player_id));
  const board = strokePlayLeaderboard(
    cards.filter((c) => !out.has(c.playerId)),
    tee,
    mode,
  );
  const withdrawn = strokePlayLeaderboard(
    cards.filter((c) => out.has(c.playerId)),
    tee,
    mode,
  ).map((r) => ({ ...r, position: 0, tied: false }));
  return { board, withdrawn };
}
