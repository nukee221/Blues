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

/**
 * The hole shown in a score slot. Slots below holes.length are the tee's holes; slot
 * holes.length + k is match extra hole 19 + k, played as tee hole ((n - 1) % 18) + 1.
 */
export function holeAt(holes: HoleInfo[], slot: number): HoleInfo {
  if (slot < holes.length) return holes[slot]!;
  const number = 19 + (slot - holes.length);
  const base = holes.find((h) => h.number === ((number - 1) % 18) + 1) ?? holes[(number - 1) % holes.length]!;
  return { number, par: base.par, strokeIndex: base.strokeIndex };
}

type MatchInput = {
  players: { id: string; name: string; playingHandicap: number }[];
  holes: HoleInfo[];
  startHole: number;
  matchStrokes: 'full' | 'offLow';
};

/** Number of extra-hole slots that hold any score. */
export function extraScored(holes: HoleInfo[], scores: Record<string, (number | null)[]>): number {
  let n = 0;
  for (const row of Object.values(scores)) {
    for (let i = holes.length; i < row.length; i++) if (row[i] != null) n = Math.max(n, i - holes.length + 1);
  }
  return n;
}

/**
 * Live match label for a two-player match card, or null when the card is not a match.
 * Regulation holes count in playing order from the start hole, then extra holes 19, 20, ...
 * (allowExtraHoles: all square after 18 continues instead of halving).
 */
export function liveMatch(view: MatchInput, scores: Record<string, (number | null)[]>): { state: MatchState; label: string } | null {
  if (view.players.length !== 2) return null;
  const [a, b] = view.players as [MatchInput['players'][number], MatchInput['players'][number]];
  const [aStrokes, bStrokes] = matchStrokes(a.playingHandicap, b.playingHandicap, view.matchStrokes);
  const order = playOrder(view.holes, view.startHole);
  const extras = extraScored(view.holes, scores);
  const slots = [...order, ...Array.from({ length: extras }, (_, k) => view.holes.length + k)];
  const pick = (id: string) => slots.map((i) => scores[id]?.[i] ?? null);
  const state = matchStatus(
    order.map((i) => view.holes[i]!),
    pick(a.id),
    pick(b.id),
    aStrokes,
    bStrokes,
    // Extra hole n is tee hole ((n - 1) % 18) + 1 whatever the start hole (as the server stores it).
    { allowExtraHoles: true, extraHoles: Array.from({ length: extras }, (_, k) => holeAt(view.holes, view.holes.length + k)) },
  );
  return { state, label: matchLabel(state, a.name, b.name) };
}

/** After 18 all square (and every extra so far halved): the next extra hole number to offer, else null. */
export function nextExtraHole(view: MatchInput & { kind: 'stroke' | 'match' }, scores: Record<string, (number | null)[]>, shown: number): number | null {
  if (view.kind !== 'match') return null;
  const m = liveMatch(view, scores);
  if (!m || m.state.finished) return null;
  const extras = Math.max(shown, extraScored(view.holes, scores));
  if (m.state.thru !== view.holes.length + extras || extras >= 18) return null;
  return 19 + extras;
}
