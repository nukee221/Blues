/**
 * Minimal in-memory stand-in for the supabase-js query builder, enough for flat
 * (non-embedded) selects, eq/neq/in/is/lt filters, insert/update/delete with optional
 * `.select()`, and `single`/`maybeSingle`. Column lists are ignored (whole rows
 * are returned). `unique` lists columns that raise a 23505 on duplicate non-null values;
 * `cascade` lists child [table, fk column] pairs deleted with a parent row (ON DELETE CASCADE).
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
export type Write = { table: string; op: 'insert' | 'update' | 'delete'; arg?: unknown };

export function createFakeDb(
  seed: Record<string, Row[]>,
  unique: Record<string, string[]> = {},
  cascade: Record<string, [string, string][]> = {},
) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Write[] = [];
  let nextId = 1;
  const newId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

  function violates(table: string, row: Row, ignore?: Row): boolean {
    return (unique[table] ?? []).some(
      (col) => row[col] != null && (tables[table] ?? []).some((o) => o !== ignore && o[col] === row[col]),
    );
  }
  /** Numbers compare numerically; ISO timestamps by instant; other strings lexically. */
  const cmp = (a: unknown, b: unknown) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const ta = Date.parse(String(a));
    const tb = Date.parse(String(b));
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  const dup = { code: '23505', message: 'duplicate key value violates unique constraint' };

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: unknown;
    let returning = false;

    function run(): { data: Row[] | null; error: { code: string; message: string } | null } {
      const rows = tables[table]!;
      const match = (r: Row) => filters.every((f) => f(r));
      if (op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made = list.map((r) => ({ id: newId(), ...r }));
        for (const r of made) if (violates(table, r)) return { data: null, error: dup };
        rows.push(...made);
        writes.push({ table, op, arg: payload });
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(match);
        for (const r of hit) if (violates(table, { ...r, ...(payload as Row) }, r)) return { data: null, error: dup };
        for (const r of hit) Object.assign(r, payload as Row);
        writes.push({ table, op, arg: payload });
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      const keep = rows.filter((r) => !match(r));
      const gone = rows.filter(match);
      tables[table] = keep;
      const dropChildren = (parent: string, ids: unknown[]) => {
        for (const [child, fk] of cascade[parent] ?? []) {
          const gone2 = (tables[child] ?? []).filter((r) => ids.includes(r[fk]));
          tables[child] = (tables[child] ?? []).filter((r) => !ids.includes(r[fk]));
          if (gone2.length) dropChildren(child, gone2.map((r) => r.id));
        }
      };
      dropChildren(table, gone.map((r) => r.id));
      writes.push({ table, op });
      return { data: gone, error: null };
    }

    const b: Record<string, unknown> = {
      select: () => {
        if (op !== 'select') returning = true;
        return b;
      },
      insert: (arg: unknown) => ((op = 'insert'), (payload = arg), b),
      update: (arg: unknown) => ((op = 'update'), (payload = arg), b),
      delete: () => ((op = 'delete'), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) < 0), b),
      order: () => b,
      limit: () => b,
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return data && data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one row' } };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return { data: data?.[0] ?? null, error: null };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        try {
          const { data, error } = run();
          return Promise.resolve(res({ data: op === 'select' || returning ? data : null, error }));
        } catch (e) {
          return rej ? Promise.resolve(rej(e)) : Promise.reject(e);
        }
      },
    };
    return b;
  }

  return { from, tables, writes };
}
