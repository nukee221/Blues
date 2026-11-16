/** "E" / "+3" / "−2" (true minus sign) for a score relative to par. */
export function formatToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** "1", or "T2" when tied. */
export function formatPos(position: number, tied: boolean): string {
  return tied ? `T${position}` : String(position);
}

/** "F" when the round is complete, else the number of holes played ("-" before the first). */
export function formatThru(thru: number): string {
  return thru >= 18 ? 'F' : thru === 0 ? '-' : String(thru);
}
