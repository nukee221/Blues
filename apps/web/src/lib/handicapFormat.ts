/**
 * How a handicap (playing handicap or index) is shown: golfers write a plus handicap as "+1",
 * not "-1". Whole numbers show without decimals ("12"), others with one ("+1.2", "8.4").
 * Display only: inputs and pasted lists keep the "+2.1" convention (handicapPaste).
 */
export function formatHandicap(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const abs = Math.round(Math.abs(n) * 10) / 10;
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return n < 0 && abs !== 0 ? `+${text}` : text;
}
