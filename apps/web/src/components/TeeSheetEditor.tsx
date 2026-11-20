'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveGroups, sendRoundTeeSheet } from '@/actions/teeSheet';
import { ok, type ActionResult } from '@/lib/actionResult';
import { releaseScorer } from '@/actions/scorecard';
import { applyPairingRules, pairGroups, standingsGroups, standingsTeeOrder, type PairingMethod, type PairingRule, type StandingEntry } from '@/lib/groups';
import { formatHandicap } from '@/lib/handicapFormat';

export type EditorPlayer = { id: string; name: string; registered: boolean; /** Handicap index; null = none. */ index?: number | null };
export type EditorGroup = {
  id?: string;
  teeTime: string; // HH:MM Central, '' = not set
  startHole: number;
  playerIds: string[];
  scorerPlayerId: string | null;
  code?: string | null;
  locked?: boolean;
  /** A phone has claimed this card's scorer role (the token itself never reaches the browser). */
  scorerDeviceHeld?: boolean;
};

const UNASSIGNED = -1;
const btn = 'min-h-[44px] rounded px-3 font-semibold disabled:opacity-50';

function addMinutes(hhmm: string, minutes: number): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const t = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const editable = (gs: EditorGroup[]) =>
  JSON.stringify(gs.map((g) => [g.id ?? null, g.teeTime, g.startHole, g.playerIds, g.scorerPlayerId]));

export default function TeeSheetEditor({
  roundId,
  eventStatus,
  players,
  initialGroups,
  rules = [],
  championIds = [],
  standings = null,
}: {
  roundId: string;
  eventStatus: string;
  players: EditorPlayer[];
  initialGroups: EditorGroup[];
  /** Tour-wide pairing rules, applied by Make groups. */
  rules?: PairingRule[];
  /** Round 1: registered past champions, for "Put past champions together". */
  championIds?: string[];
  /** Later rounds: scores so far, for "By standings" (leaders tee off last). */
  standings?: StandingEntry[] | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [groups, setGroups] = useState<EditorGroup[]>(initialGroups);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [method, setMethod] = useState<PairingMethod | 'standings'>(standings ? 'standings' : 'handicap');
  const [champsTogether, setChampsTogether] = useState(championIds.length > 1);
  const [size, setSize] = useState(4);
  const [unmet, setUnmet] = useState<string[]>([]);

  useEffect(() => setGroups(initialGroups), [initialGroups]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const locked = initialGroups.some((g) => g.locked);
  const dirty = editable(groups) !== editable(initialGroups);
  const grouped = new Set(groups.flatMap((g) => g.playerIds));
  const unassigned = players.filter((p) => p.registered && !grouped.has(p.id));
  const canSend =
    !dirty && initialGroups.length > 0 && (eventStatus === 'registration_closed' || eventStatus === 'in_progress');
  const sentAlready = initialGroups.length > 0 && initialGroups.every((g) => g.code);

  function freeScorer(groupId: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const r = await releaseScorer(groupId);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setNotice('Scorer phone freed: the scorer can now open the card on another phone.');
        router.refresh();
      } catch {
        setError('Could not free the scorer phone');
      }
    });
  }

  function update(i: number, patch: Partial<EditorGroup>) {
    setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  }

  function moveSelected(to: number) {
    if (!selected) return;
    const pid = selected;
    setGroups((gs) =>
      gs.map((g, k) => {
        const without = g.playerIds.filter((p) => p !== pid);
        const playerIds = k === to ? [...without, pid] : without;
        return { ...g, playerIds, scorerPlayerId: playerIds.includes(g.scorerPlayerId ?? '') ? g.scorerPlayerId : null };
      }),
    );
    setSelected(null);
  }

  function makeGroups() {
    if (groups.some((g) => g.playerIds.length > 0) && !window.confirm('Replace the current groups? Nothing is saved until you tap Save groups.')) return;
    const base = groups[0]?.teeTime ?? '';
    const field = players.filter((p) => p.registered).map((p) => ({ id: p.id, index: p.index ?? null }));
    let made: { groups: string[][]; unmet: PairingRule[] };
    if (method === 'standings') {
      const known = new Map((standings ?? []).map((e) => [e.id, e]));
      const order = standingsTeeOrder(field.map((p) => known.get(p.id) ?? { id: p.id, toPar: null, finishedAt: null }));
      // rules swap players next to each other in the standings, not by handicap
      made = applyPairingRules(standingsGroups(order, size), rules, Object.fromEntries(order.map((id, i) => [id, i])));
    } else {
      made = applyPairingRules(
        pairGroups(field, { method, size, first: champsTogether ? championIds : [] }),
        rules,
        Object.fromEntries(field.map((p) => [p.id, p.index])),
      );
    }
    const nm = (id: string) => byId.get(id)?.name ?? 'Player';
    setUnmet(made.unmet.map((r) => `${nm(r.a)} ${r.kind === 'together' ? 'with' : 'apart from'} ${nm(r.b)}`));
    setGroups(
      made.groups.map((playerIds, i) => ({
        teeTime: base ? addMinutes(base, i * 10) : '',
        startHole: 1,
        playerIds,
        scorerPlayerId: null,
      })),
    );
    setSelected(null);
  }

  function addGroup() {
    const last = groups[groups.length - 1];
    setGroups((gs) => [...gs, { teeTime: last?.teeTime ? addMinutes(last.teeTime, 10) : '', startHole: 1, playerIds: [], scorerPlayerId: null }]);
  }

  function run(fn: () => Promise<ActionResult<string>>) {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(result.data);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    });
  }

  function save() {
    const nonEmpty = groups.filter((g) => g.playerIds.length > 0);
    run(async () => {
      const result = await saveGroups(
        roundId,
        nonEmpty.map((g) => ({
          ...(g.id ? { id: g.id } : {}),
          teeTime: g.teeTime || null,
          startHole: g.startHole,
          playerIds: g.playerIds,
          scorerPlayerId: g.scorerPlayerId,
        })),
      );
      return result.ok ? ok('Groups saved') : result;
    });
  }

  function send() {
    if (sentAlready && !window.confirm('Resend the tee sheet emails? Codes stay the same.')) return;
    run(async () => {
      const result = await sendRoundTeeSheet(roundId);
      if (!result.ok) return result;
      const { sent } = result.data;
      return ok(`Tee sheet sent to ${sent} player${sent === 1 ? '' : 's'}`);
    });
  }

  function chip(pid: string) {
    const p = byId.get(pid);
    const isSel = selected === pid;
    return (
      <button
        key={pid}
        type="button"
        disabled={locked || pending}
        aria-pressed={isSel}
        onClick={() => setSelected(isSel ? null : pid)}
        className={`min-h-[44px] rounded border px-3 text-left ${isSel ? 'border-green-700 bg-green-100' : 'bg-white'} ${p?.registered === false ? 'text-red-700' : ''}`}
      >
        {p?.name ?? 'Unknown player'}
        {p && p.index !== undefined && <span className="ml-1 text-sm text-gray-600">{formatHandicap(p.index)}</span>}
        {p?.registered === false ? ' (not registered)' : ''}
      </button>
    );
  }

  function moveHere(target: number, label: string) {
    if (!selected || locked) return null;
    const here = target === UNASSIGNED ? !grouped.has(selected) : groups[target]?.playerIds.includes(selected);
    if (here) return null;
    return (
      <button type="button" onClick={() => moveSelected(target)} className={`${btn} w-full border border-dashed border-green-700 text-green-800`}>
        Move {byId.get(selected)?.name ?? 'player'} {label}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {locked && <p className="rounded bg-yellow-100 p-3">A scorecard in this round is locked or signed; groups can no longer change.</p>}
      {selected && <p className="text-sm text-gray-700">Tap a group&apos;s “Move” button to place the selected player.</p>}

      <section aria-labelledby="pairings-heading" className="space-y-3 rounded border p-3">
        <h2 id="pairings-heading" className="text-lg font-semibold">Make groups</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Pair players
            <select
              value={method}
              disabled={locked || pending}
              onChange={(e) => setMethod(e.target.value as PairingMethod | 'standings')}
              className="block min-h-[44px] w-full rounded border px-2 text-base"
            >
              {standings && <option value="standings">By standings</option>}
              <option value="handicap">By handicap</option>
              <option value="balanced">Mixed handicaps</option>
              <option value="random">Random</option>
            </select>
          </label>
          <label className="text-sm">
            Players per group
            <select
              value={size}
              disabled={locked || pending}
              onChange={(e) => setSize(Number(e.target.value))}
              className="block min-h-[44px] w-full rounded border px-2 text-base"
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-gray-600">
          {method === 'standings'
            ? 'Leaders tee off last. Ties: first in, last out (who finished the last round first goes off later).'
            : method === 'handicap'
            ? 'Similar handicaps play together, lowest first.'
            : method === 'balanced'
              ? 'Each group gets a mix of low and high handicaps.'
              : 'Groups are drawn at random.'}{' '}
          Uneven numbers make some groups one smaller.
        </p>
        {championIds.length > 0 && method !== 'standings' && (
          <label className="flex min-h-[44px] items-center gap-3">
            <input
              type="checkbox"
              checked={champsTogether}
              disabled={locked || pending}
              onChange={(e) => setChampsTogether(e.target.checked)}
              className="h-5 w-5"
            />
            <span>
              Put past champions together
              <span className="block text-sm text-gray-600">
                {championIds.map((id) => byId.get(id)?.name ?? 'Player').join(', ')}
              </span>
            </span>
          </label>
        )}
        <button type="button" onClick={makeGroups} disabled={locked || pending} className={`${btn} w-full bg-green-700 text-white`}>
          Make groups
        </button>
        {rules.length > 0 && unmet.length === 0 && (
          <p className="text-sm text-gray-600">Pairing rules are followed (see Pairing rules below).</p>
        )}
        {unmet.length > 0 && (
          <p role="alert" className="rounded bg-yellow-100 p-2 text-sm">
            Could not meet: {unmet.join('; ')}. Move players by hand if needed.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Unassigned ({unassigned.length})</h2>
        <div className="flex flex-wrap gap-2">{unassigned.map((p) => chip(p.id))}</div>
        {moveHere(UNASSIGNED, 'out of groups')}
      </section>

      {groups.map((g, i) => (
        <section key={g.id ?? `new-${i}`} className="space-y-2 rounded border p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Group {i + 1}</h3>
            {g.code && <span className="font-mono text-lg tracking-widest" aria-label="Group code">{g.code}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Tee time
              <input
                type="time"
                value={g.teeTime}
                disabled={locked}
                onChange={(e) => update(i, { teeTime: e.target.value })}
                className="block min-h-[44px] w-full rounded border px-2 text-base"
              />
            </label>
            <label className="text-sm">
              Start hole
              <select
                value={g.startHole}
                disabled={locked}
                onChange={(e) => update(i, { startHole: Number(e.target.value) })}
                className="block min-h-[44px] w-full rounded border px-2 text-base"
              >
                {Array.from({ length: 18 }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">{g.playerIds.map((pid) => chip(pid))}</div>
          {g.playerIds.length === 0 && <p className="text-sm text-gray-500">Empty: removed on save.</p>}
          <label className="block text-sm">
            Scorer
            <select
              value={g.scorerPlayerId ?? ''}
              disabled={locked}
              onChange={(e) => update(i, { scorerPlayerId: e.target.value || null })}
              className="block min-h-[44px] w-full rounded border px-2 text-base"
            >
              <option value="">No scorer yet</option>
              {g.playerIds.map((pid) => (
                <option key={pid} value={pid}>
                  {byId.get(pid)?.name ?? pid}
                </option>
              ))}
            </select>
          </label>
          {g.id && g.scorerDeviceHeld && !g.locked && (
            <button
              type="button"
              disabled={pending}
              onClick={() => freeScorer(g.id!)}
              className={`${btn} border border-slate-900`}
            >
              Free scorer phone (hand-off)
            </button>
          )}
          {g.id && (
            <Link href={`/admin/cards/${g.id}`} className={`${btn} flex items-center justify-center border border-green-700 text-green-800`}>
              {g.locked ? 'Scorecard (signed)' : 'Scorecard'}
            </Link>
          )}
          {moveHere(i, `to group ${i + 1}`)}
        </section>
      ))}

      <button type="button" onClick={addGroup} disabled={locked || pending} className={`${btn} w-full border`}>
        Add group
      </button>

      <div className="sticky bottom-0 space-y-2 bg-white py-2">
        {error && <p className="text-red-700" role="alert">{error}</p>}
        {notice && <p className="text-green-800" role="status">{notice}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={save} disabled={locked || pending || !dirty} className={`${btn} bg-green-700 text-white`}>
            Save groups
          </button>
          <button type="button" onClick={send} disabled={pending || !canSend} className={`${btn} border border-green-700 text-green-800`}>
            {sentAlready ? 'Resend tee sheet' : 'Send tee sheet'}
          </button>
        </div>
        {dirty && <p className="text-sm text-gray-600">Save before sending.</p>}
        {eventStatus !== 'registration_closed' && eventStatus !== 'in_progress' && (
          <p className="text-sm text-gray-600">Close registration before sending the tee sheet.</p>
        )}
      </div>
    </div>
  );
}
