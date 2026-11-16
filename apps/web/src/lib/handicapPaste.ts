export type ParsedHandicaps = {
  matched: { playerId: string; index: number }[];
  unmatched: string[];
  errors: { line: number; message: string }[];
};

export const MIN_INDEX = -10;
export const MAX_INDEX = 54;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Parse pasted "name, index" lines. Separators: tab, comma, or 2+ spaces (a single
 * space before a trailing number is also accepted when no other separator exists).
 * The last field is the index; "+2.1" is a plus handicap stored as -2.1.
 */
export function parseHandicapPaste(text: string, roster: { id: string; name: string }[]): ParsedHandicaps {
  const out: ParsedHandicaps = { matched: [], unmatched: [], errors: [] };
  const byName = new Map(roster.map((p) => [norm(p.name), p.id]));
  const used = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    const err = (message: string) => out.errors.push({ line, message });

    let fields = raw.trim().split(/\t|,|\s{2,}/).map((f) => f.trim()).filter((f) => f !== '');
    if (fields.length === 1) {
      const m = fields[0]!.match(/^(.*\S)\s+(\S+)$/);
      if (m) fields = [m[1]!, m[2]!];
    }
    if (fields.length < 2) return err('Expected a name and a handicap index');
    const idxText = fields[fields.length - 1]!;
    const name = fields.slice(0, -1).join(' ');

    if (idxText.startsWith('-')) return err('Use + for plus handicaps');
    const plus = idxText.startsWith('+');
    const digits = plus ? idxText.slice(1) : idxText;
    if (!/^\d+(\.\d+)?$/.test(digits)) return err(`Invalid handicap index "${idxText}"`);
    const value = Math.round(Number(digits) * (plus ? -1 : 1) * 10) / 10;
    if (value < MIN_INDEX || value > MAX_INDEX) return err(`Index out of range (${MIN_INDEX} to ${MAX_INDEX})`);

    const id = byName.get(norm(name));
    if (!id) {
      out.unmatched.push(name.replace(/\s+/g, ' '));
      return;
    }
    if (used.has(id)) return err('Duplicate');
    used.add(id);
    out.matched.push({ playerId: id, index: value === 0 ? 0 : value });
  });
  return out;
}
