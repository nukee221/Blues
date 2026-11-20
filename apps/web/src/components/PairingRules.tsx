'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addPairingRule, removePairingRule } from '@/actions/pairingRules';

export type RuleRow = { id: string; a: string; b: string; kind: 'together' | 'apart' };
type Person = { id: string; name: string };

const field = 'block min-h-[44px] w-full rounded border px-2 text-base';
const btn = 'min-h-[44px] rounded px-3 font-semibold disabled:opacity-50';

/** Tour-wide pairing rules ("plays with" / "keep apart"), used by Make groups. */
export default function PairingRules({ rules, people }: { rules: RuleRow[]; people: Person[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [kind, setKind] = useState<'together' | 'apart'>('together');
  const [error, setError] = useState<string | null>(null);
  const name = new Map(people.map((p) => [p.id, p.name]));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          setError(r.error ?? 'Something went wrong');
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError('Something went wrong');
      }
    });
  }

  const list = [...rules].sort((x, y) => x.kind.localeCompare(y.kind) || (name.get(x.a) ?? '').localeCompare(name.get(y.a) ?? ''));

  return (
    <details className="rounded border p-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-lg font-semibold">
        <span>Pairing rules ({rules.length})</span>
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-sm text-gray-600">For the whole tour. Make groups follows these where it can and tells you if one can’t be met.</p>
        {list.length > 0 && (
          <ul className="space-y-1">
            {list.map((r) => (
              <li key={r.id} className="flex min-h-[44px] items-center justify-between gap-2 rounded bg-gray-50 px-2">
                <span className="text-sm">
                  <span className="font-semibold">{name.get(r.a) ?? 'Player'}</span>{' '}
                  <span className={r.kind === 'together' ? 'text-green-800' : 'text-red-700'}>
                    {r.kind === 'together' ? 'plays with' : 'not with'}
                  </span>{' '}
                  <span className="font-semibold">{name.get(r.b) ?? 'Player'}</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removePairingRule(r.id))}
                  className={`${btn} shrink-0 text-sm text-red-700`}
                  aria-label={`Remove rule: ${name.get(r.a)} and ${name.get(r.b)}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <label className="block text-sm">
            Player
            <select aria-label="Player" value={a} onChange={(e) => setA(e.target.value)} className={field}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Rule
            <select aria-label="Rule" value={kind} onChange={(e) => setKind(e.target.value as 'together' | 'apart')} className={field}>
              <option value="together">likes to play with</option>
              <option value="apart">should not be grouped with</option>
            </select>
          </label>
          <label className="block text-sm">
            Other player
            <select aria-label="Other player" value={b} onChange={(e) => setB(e.target.value)} className={field}>
              <option value="">Choose…</option>
              {people.filter((p) => p.id !== a).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !a || !b}
            onClick={() => run(() => addPairingRule({ playerA: a, playerB: b, kind }), () => { setA(''); setB(''); })}
            className={`${btn} w-full border border-green-700 text-green-800`}
          >
            Add rule
          </button>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </details>
  );
}
