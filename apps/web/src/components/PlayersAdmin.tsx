'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { applyHandicapUpdates, savePlayer } from '@/actions/players';
import { parseHandicapPaste } from '@/lib/handicapPaste';
import { HANDICAP_SOURCES, playerSchema } from '@/lib/playerSchema';

export type PlayerListItem = {
  id: string;
  name: string;
  email: string;
  handicap_index: number | null;
  handicap_source: (typeof HANDICAP_SOURCES)[number] | null;
  is_commissioner: boolean;
};

type Draft = { id?: string; name: string; email: string; index: string; source: (typeof HANDICAP_SOURCES)[number]; commissioner: boolean };
const blank: Draft = { name: '', email: '', index: '', source: 'GHIN', commissioner: false };
const field = 'min-h-[44px] w-full rounded border px-3 text-base';
const btn = 'min-h-[44px] rounded px-4 font-semibold';

const fmt = (n: number | null) => (n === null ? '–' : n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1));

export default function PlayersAdmin({ players }: { players: PlayerListItem[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paste, setPaste] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  const names = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const preview = useMemo(
    () => (paste.trim() ? parseHandicapPaste(paste, players.map((p) => ({ id: p.id, name: p.name }))) : null),
    [paste, players],
  );

  function save() {
    if (!draft) return;
    const parsed = playerSchema.safeParse({
      id: draft.id,
      name: draft.name,
      email: draft.email,
      handicapIndex: draft.index.trim() === '' ? NaN : Number(draft.index),
      handicapSource: draft.source,
      isCommissioner: draft.commissioner,
    });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }
    setErrors([]);
    start(async () => {
      try {
        await savePlayer(parsed.data);
        setDraft(null);
        setMessage('Player saved');
        router.refresh();
      } catch (e) {
        setErrors([e instanceof Error ? e.message : 'Save failed']);
      }
    });
  }

  function apply() {
    if (!preview || preview.matched.length === 0) return;
    start(async () => {
      try {
        const r = await applyHandicapUpdates(preview.matched);
        setMessage(`Updated ${r.updated} handicap${r.updated === 1 ? '' : 's'}`);
        setPaste('');
        router.refresh();
      } catch (e) {
        setErrors([e instanceof Error ? e.message : 'Update failed']);
      }
    });
  }

  return (
    <div className="space-y-6">
      {message && <p role="status" className="rounded bg-green-50 p-3 text-green-800">{message}</p>}
      {errors.length > 0 && (
        <ul role="alert" className="rounded bg-red-50 p-3 text-red-800">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      <section className="space-y-2">
        <button type="button" className={`${btn} w-full bg-green-700 text-white`} onClick={() => { setDraft({ ...blank }); setErrors([]); }}>
          Add player
        </button>
        <ul className="space-y-2">
          {players.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="block min-h-[44px] w-full rounded border p-3 text-left"
                onClick={() => {
                  setErrors([]);
                  setDraft({
                    id: p.id, name: p.name, email: p.email,
                    index: p.handicap_index === null ? '' : String(p.handicap_index),
                    source: p.handicap_source ?? 'GHIN', commissioner: p.is_commissioner,
                  });
                }}
              >
                <div className="font-semibold">{p.name}{p.is_commissioner && <span className="ml-2 text-sm text-green-700">Commissioner</span>}</div>
                <div className="text-sm text-gray-600">{p.email} · {fmt(p.handicap_index)} {p.handicap_source ?? ''}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {draft && (
        <section className="space-y-3 rounded border p-3">
          <h2 className="text-lg font-bold">{draft.id ? 'Edit player' : 'Add player'}</h2>
          <label className="block">Name
            <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block">Email
            <input className={field} type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </label>
          <label className="block">Handicap index (negative = plus handicap)
            <input className={field} inputMode="decimal" value={draft.index} onChange={(e) => setDraft({ ...draft, index: e.target.value })} />
          </label>
          <label className="block">Source
            <select className={field} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as Draft['source'] })}>
              {HANDICAP_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" className="h-5 w-5" checked={draft.commissioner} onChange={(e) => setDraft({ ...draft, commissioner: e.target.checked })} />
            Commissioner
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={pending} className={`${btn} flex-1 bg-green-700 text-white`} onClick={save}>Save player</button>
            <button type="button" className={`${btn} border`} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Bulk update handicaps</h2>
        <p className="text-sm text-gray-600">One player per line: name, then index (tab, comma, or 2+ spaces). Use +2.1 for plus handicaps.</p>
        <textarea className={`${field} min-h-[120px] py-2`} aria-label="Handicap paste" value={paste} onChange={(e) => setPaste(e.target.value)} />
        {preview && (
          <div className="space-y-2" data-testid="preview">
            <div>
              <h3 className="font-semibold">Matched ({preview.matched.length})</h3>
              <ul className="text-sm">
                {preview.matched.map((m) => <li key={m.playerId}>{names.get(m.playerId)}: {fmt(m.index)}</li>)}
              </ul>
            </div>
            {preview.unmatched.length > 0 && (
              <div>
                <h3 className="font-semibold text-amber-700">Unmatched ({preview.unmatched.length})</h3>
                <ul className="text-sm">{preview.unmatched.map((u, i) => <li key={i}>{u}</li>)}</ul>
              </div>
            )}
            {preview.errors.length > 0 && (
              <div>
                <h3 className="font-semibold text-red-700">Errors ({preview.errors.length})</h3>
                <ul className="text-sm">{preview.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul>
              </div>
            )}
            <button type="button" disabled={pending || preview.matched.length === 0} className={`${btn} w-full bg-green-700 text-white disabled:opacity-50`} onClick={apply}>
              Apply {preview.matched.length} update{preview.matched.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
