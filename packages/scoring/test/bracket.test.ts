import { describe, it, expect } from 'vitest';
import { drawBracket, recordWinner, bracketFinishPositions } from '../src/bracket';
import type { Bracket } from '../src/bracket';

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const find = (b: Bracket, id: string) => b.matches.find((m) => m.id === id)!;

describe('drawBracket', () => {
  it('gives six players two byes that never meet', () => {
    const b = drawBracket(ids(6), mulberry32(1));
    expect(b.size).toBe(8);
    expect(b.rounds).toBe(3);
    const r1 = b.matches.filter((m) => m.round === 1);
    expect(r1).toHaveLength(4);
    const byes = r1.filter((m) => m.isBye);
    expect(byes).toHaveLength(2);
    expect(b.matches.some((m) => m.a === null && m.b === null && m.round === 1)).toBe(false);
    for (const m of byes) {
      expect(m.winner).not.toBeNull();
      const next = find(b, `R2M${Math.ceil(m.slot / 2)}`);
      expect(m.slot % 2 === 1 ? next.a : next.b).toBe(m.winner);
    }
  });
  it('is deterministic per seed and varies across seeds', () => {
    expect(drawBracket(ids(8), mulberry32(7))).toEqual(drawBracket(ids(8), mulberry32(7)));
    const base = JSON.stringify(drawBracket(ids(8), mulberry32(0)).matches);
    let differs = false;
    for (let s = 1; s <= 20; s++) {
      if (JSON.stringify(drawBracket(ids(8), mulberry32(s)).matches) !== base) differs = true;
    }
    expect(differs).toBe(true);
  });
  it('does not mutate its input and rejects bad input', () => {
    const input = ids(5);
    drawBracket(input, mulberry32(3));
    expect(input).toEqual(ids(5));
    expect(() => drawBracket(['a'], mulberry32(1))).toThrow();
    expect(() => drawBracket(['a', 'a'], mulberry32(1))).toThrow();
  });
  it('handles two players', () => {
    const b = drawBracket(ids(2), mulberry32(1));
    expect(b.size).toBe(2);
    expect(b.rounds).toBe(1);
    expect(b.matches).toHaveLength(1);
  });
});

describe('recordWinner', () => {
  it('is pure and advances into the correct side', () => {
    const b = drawBracket(ids(8), mulberry32(5));
    const snapshot = JSON.stringify(b);
    const m = find(b, 'R1M2');
    const b2 = recordWinner(b, 'R1M2', m.a!);
    expect(JSON.stringify(b)).toBe(snapshot);
    expect(find(b2, 'R1M2').winner).toBe(m.a);
    expect(find(b2, 'R2M1').b).toBe(m.a);
    const m3 = find(b, 'R1M3');
    expect(find(recordWinner(b, 'R1M3', m3.b!), 'R2M2').a).toBe(m3.b);
  });
  it('throws for unknown match, non-participant, and bye', () => {
    const b = drawBracket(ids(8), mulberry32(5));
    expect(() => recordWinner(b, 'R9M9', 'p1')).toThrow();
    const m = find(b, 'R1M1');
    const outsider = b.matches.find((x) => x.round === 1 && x.id !== 'R1M1')!.a!;
    expect(outsider).not.toBe(m.a);
    expect(() => recordWinner(b, 'R1M1', outsider)).toThrow();
    const six = drawBracket(ids(6), mulberry32(2));
    const bye = six.matches.find((x) => x.isBye)!;
    expect(() => recordWinner(six, bye.id, bye.winner!)).toThrow();
  });
});

function playOut(b: Bracket): Bracket {
  let cur = b;
  for (let r = 1; r <= b.rounds; r++) {
    for (const m of cur.matches.filter((x) => x.round === r && !x.isBye)) {
      const live = find(cur, m.id);
      cur = recordWinner(cur, m.id, live.a!);
    }
  }
  return cur;
}

describe('bracketFinishPositions', () => {
  it('places 8 players 1, 2, T3 x2, T5 x4', () => {
    const done = playOut(drawBracket(ids(8), mulberry32(11)));
    const p = bracketFinishPositions(done);
    expect(p).toHaveLength(8);
    const count = (pos: number) => p.filter((x) => x.position === pos);
    expect(count(1)).toHaveLength(1);
    expect(count(2)).toHaveLength(1);
    expect(count(3)).toHaveLength(2);
    expect(count(5)).toHaveLength(4);
    expect(count(1)[0]!.tied).toBe(false);
    expect(count(2)[0]!.tied).toBe(false);
    expect(count(3).every((x) => x.tied)).toBe(true);
    expect(count(5).every((x) => x.tied)).toBe(true);
  });
  it('places 6 players with bye-free first-round losers T5', () => {
    const p = bracketFinishPositions(playOut(drawBracket(ids(6), mulberry32(4))));
    expect(p).toHaveLength(6);
    expect(p.filter((x) => x.position === 5)).toHaveLength(2);
    expect(p.filter((x) => x.position === 3)).toHaveLength(2);
  });
  it('throws when the final has no winner', () => {
    expect(() => bracketFinishPositions(drawBracket(ids(4), mulberry32(1)))).toThrow();
  });
});
