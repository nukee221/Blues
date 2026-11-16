import type { Placing } from './types';

export type BracketMatch = {
  id: string;
  round: number;
  slot: number;
  a: string | null;
  b: string | null;
  winner: string | null;
  isBye: boolean;
};
export type Bracket = { size: number; rounds: number; matches: BracketMatch[] };

/** Standard seed order, e.g. size 8 -> [1,8,4,5,2,7,3,6]. */
function seedOrder(size: number): number[] {
  if (size === 1) return [1];
  return seedOrder(size / 2).flatMap((s) => [s, size + 1 - s]);
}

export function drawBracket(playerIds: string[], rng: () => number): Bracket {
  if (playerIds.length < 2) throw new Error('A bracket needs at least 2 players');
  if (new Set(playerIds).size !== playerIds.length) throw new Error('Duplicate player ids');
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  let size = 2;
  while (size < shuffled.length) size *= 2;
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const playerForSeed = (seed: number): string | null => shuffled[seed - 1] ?? null;

  const matches: BracketMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    for (let slot = 1; slot <= count; slot++) {
      const m: BracketMatch = {
        id: `R${round}M${slot}`, round, slot, a: null, b: null, winner: null, isBye: false,
      };
      if (round === 1) {
        m.a = playerForSeed(order[2 * slot - 2]!);
        m.b = playerForSeed(order[2 * slot - 1]!);
        if ((m.a === null) !== (m.b === null)) {
          m.isBye = true;
          m.winner = m.a ?? m.b;
        }
      }
      matches.push(m);
    }
  }
  const bracket: Bracket = { size, rounds, matches };
  for (const m of matches) {
    if (m.isBye) advance(bracket, m);
  }
  return bracket;
}

/** Mutates `bracket`: places m.winner into the next round. */
function advance(bracket: Bracket, m: BracketMatch): void {
  if (m.round >= bracket.rounds) return;
  const next = bracket.matches.find(
    (x) => x.round === m.round + 1 && x.slot === Math.ceil(m.slot / 2),
  )!;
  if (m.slot % 2 === 1) next.a = m.winner;
  else next.b = m.winner;
}

export function recordWinner(bracket: Bracket, matchId: string, winnerId: string): Bracket {
  const copy: Bracket = { ...bracket, matches: bracket.matches.map((m) => ({ ...m })) };
  const m = copy.matches.find((x) => x.id === matchId);
  if (!m) throw new Error(`Unknown match ${matchId}`);
  if (m.isBye) throw new Error(`Match ${matchId} is a bye`);
  if (winnerId !== m.a && winnerId !== m.b) {
    throw new Error(`Player ${winnerId} is not in match ${matchId}`);
  }
  m.winner = winnerId;
  advance(copy, m);
  return copy;
}

export function bracketFinishPositions(bracket: Bracket): Placing[] {
  const final = bracket.matches.find((m) => m.round === bracket.rounds);
  if (!final || final.winner === null) throw new Error('The final has no winner');
  const placings: Placing[] = [{ playerId: final.winner, position: 1, tied: false }];
  for (let round = bracket.rounds; round >= 1; round--) {
    const losers: string[] = [];
    for (const m of bracket.matches) {
      if (m.round !== round || m.isBye || m.winner === null || m.a === null || m.b === null) continue;
      losers.push(m.winner === m.a ? m.b : m.a);
    }
    const position = bracket.size / 2 ** round + 1;
    for (const playerId of losers) {
      placings.push({ playerId, position, tied: losers.length > 1 });
    }
  }
  return placings;
}
