import { matchStatus, matchStrokes, strokesOnHole, type HoleInfo, type MatchState } from '@hgt/scoring';

/** Hole indexes in playing order, starting from the group's start hole (shotgun starts). */
export function playOrder(holes: HoleInfo[], startHole: number): number[] {
  const start = Math.max(0, holes.findIndex((h) => h.number === startHole));
  return holes.map((_, i) => (start + i) % holes.length);
}

/** Strokes a player receives on a hole and the resulting net (null when no gross yet). */
export function netOnHole(gross: number | null, playingHandicap: number, hole: HoleInfo, holeCount: number) {
  const strokes = strokesOnHole(playingHandicap, hole.strokeIndex, holeCount);
  return { strokes, net: gross == null ? null : gross - strokes };
}

/** Replace matchStatus's A/B with names: "Alex 2 UP thru 5", "Alex wins 3&2", "AS thru 4". */
export function matchLabel(state: MatchState, aName: string, bName: string): string {
  const name = (side: string) => (side === 'A' ? aName : bName);
  if (/^[AB] /.test(state.label)) return state.label.replace(/^[AB]/, name);
  if (state.finished && (state.winner === 'A' || state.winner === 'B')) return `${name(state.winner)} wins ${state.label}`;
  return state.label;
}

type MatchInput = {
  players: { id: string; name: string; playingHandicap: number }[];
  holes: HoleInfo[];
  startHole: number;
  matchStrokes: 'full' | 'offLow';
};

/** Live match label for a two-player match card, or null when the card is not a match. */
export function liveMatch(view: MatchInput, scores: Record<string, (number | null)[]>): { state: MatchState; label: string } | null {
  if (view.players.length !== 2) return null;
  const [a, b] = view.players as [MatchInput['players'][number], MatchInput['players'][number]];
  const [aStrokes, bStrokes] = matchStrokes(a.playingHandicap, b.playingHandicap, view.matchStrokes);
  const order = playOrder(view.holes, view.startHole);
  const pick = (id: string) => order.map((i) => scores[id]?.[i] ?? null);
  const state = matchStatus(
    order.map((i) => view.holes[i]!),
    pick(a.id),
    pick(b.id),
    aStrokes,
    bStrokes,
    { allowExtraHoles: true },
  );
  return { state, label: matchLabel(state, a.name, b.name) };
}
