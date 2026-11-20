/** One group on event day: has its scorer entered the code, started scoring, signed the card. */
export type DayGroup = { roundNumber: number; joined: boolean; scoring: boolean; signed: boolean };

export type DayCounts = {
  roundNumber: number;
  total: number;
  joined: number;
  scoring: number;
  signed: number;
  allSigned: boolean;
};

/**
 * Live counts for the event page's "next step" box: the round being played is the first one
 * with a card still unsigned (or the last round once every card is signed).
 */
export function eventDayCounts(groups: DayGroup[]): DayCounts | null {
  if (groups.length === 0) return null;
  const rounds = [...new Set(groups.map((x) => x.roundNumber))].sort((a, b) => a - b);
  const open = rounds.find((n) => groups.some((x) => x.roundNumber === n && !x.signed));
  const roundNumber = open ?? rounds[rounds.length - 1]!;
  const inRound = groups.filter((x) => x.roundNumber === roundNumber);
  return {
    roundNumber,
    total: inRound.length,
    joined: inRound.filter((x) => x.joined).length,
    scoring: inRound.filter((x) => x.scoring).length,
    signed: inRound.filter((x) => x.signed).length,
    allSigned: open === undefined,
  };
}
