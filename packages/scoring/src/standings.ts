import { round2 } from './points';
import { rankWithTies } from './rank';

export type Award = { playerId: string; eventId: string; points: number };
export type StandingsRow = {
  playerId: string;
  total: number;
  position: number;
  tied: boolean;
  qualified: boolean;
  byEvent: { eventId: string; points: number }[];
};

export function seasonStandings(awards: Award[], qualifyingSpots = 8): StandingsRow[] {
  const eventOrder: string[] = [];
  const seen = new Set<string>();
  const players = new Map<string, Map<string, number>>();
  for (const a of awards) {
    if (!seen.has(a.eventId)) {
      seen.add(a.eventId);
      eventOrder.push(a.eventId);
    }
    let m = players.get(a.playerId);
    if (!m) players.set(a.playerId, (m = new Map()));
    m.set(a.eventId, (m.get(a.eventId) ?? 0) + a.points);
  }
  const rows = [...players.entries()].map(([playerId, m]) => {
    const byEvent = eventOrder
      .filter((e) => m.has(e))
      .map((eventId) => ({ eventId, points: round2(m.get(eventId)!) }));
    let sum = 0;
    for (const v of m.values()) sum += v;
    return { playerId, total: round2(sum), byEvent };
  });
  return rankWithTies(rows, (r) => -r.total).map(({ item, position, tied }) => ({
    ...item,
    position,
    tied,
    qualified: position <= qualifyingSpots,
  }));
}
