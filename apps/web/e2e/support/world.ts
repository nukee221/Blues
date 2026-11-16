import type { BrowserContext } from '@playwright/test';

/** Shared state between the serial stages of the rehearsal. */
export type World = {
  eventId: string;
  eventName: string;
  roundId: string;
  teeId: string;
  /** 18 pars in hole order. */
  pars: number[];
  /** Player email -> id / name, for the 12 seeded players. */
  players: Map<string, { id: string; name: string; email: string }>;
  /** Signing PIN per player email (set through the UI or seeded). */
  pins: Map<string, string>;
  groups: { id: string; code: string; scorerId: string; members: { id: string; email: string; name: string; ph: number }[] }[];
  contexts: Map<string, BrowserContext>;
};

/** Net totals the 12 players are scored to in the play-in: unique, so the cut is unambiguous. Best first. */
export const FIELD: { email: string; net: number }[] = [
  { email: 'player10@example.test', net: 68 }, // Jordan Pike
  { email: 'player08@example.test', net: 70 }, // Hunter Lane
  { email: 'player04@example.test', net: 72 }, // Drew Patterson
  { email: 'player06@example.test', net: 74 }, // Finn Gallagher
  { email: 'player05@example.test', net: 76 }, // Evan Brooks
  { email: 'player11@example.test', net: 78 }, // Kyle Sanders
  { email: 'player02@example.test', net: 80 },
  { email: 'player07@example.test', net: 82 },
  { email: 'player03@example.test', net: 84 },
  { email: 'player09@example.test', net: 86 },
  { email: 'player01@example.test', net: 88 },
  { email: 'player12@example.test', net: 90 },
];
export const ADVANCERS = FIELD.slice(0, 6).map((f) => f.email);

/**
 * Per-hole strokes over par that add up to `total` (floor-spread, rotated by `shift` so the
 * extra strokes do not always land on the first holes).
 */
export function spread(total: number, shift: number): number[] {
  const q = Math.floor(total / 18);
  const r = total - q * 18;
  return Array.from({ length: 18 }, (_, i) => (((i + shift) % 18) < r ? q + 1 : q));
}

/** Gross scores (hole order) for a player scored to `targetNet` with playing handicap `ph`. */
export function grossFor(pars: number[], targetNet: number, ph: number, shift: number): number[] {
  const parTotal = pars.reduce((a, b) => a + b, 0);
  const d = spread(targetNet + ph - parTotal, shift);
  return pars.map((p, i) => Math.max(1, p + d[i]!));
}
