'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveEvent } from '@/actions/events';
import { centralInputToIso, isoToCentralInput } from '@/lib/time';
import { eventSchema, type EventInput } from '@/lib/eventSchema';
import { EVENT_TYPES } from '@/lib/eventStatus';
import EventStatusButtons from '@/components/EventStatusButtons';
import type { EventStatus } from '@/lib/eventStatus';

export type EventFormValue = EventInput;
export type SeasonOption = { id: string; year: number };
export type TeeOption = { id: string; label: string };

const input = 'min-h-[44px] w-full rounded border px-3 text-base';

export default function EventForm({
  initial,
  status,
  seasons,
  tees,
}: {
  initial: EventFormValue;
  status?: EventStatus;
  seasons: SeasonOption[];
  tees: TeeOption[];
}) {
  const router = useRouter();
  const [ev, setEv] = useState<EventFormValue>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const set = (patch: Partial<EventFormValue>) => setEv((e) => ({ ...e, ...patch }));
  const setRound = (i: number, patch: Partial<EventFormValue['rounds'][number]>) =>
    setEv((e) => ({ ...e, rounds: e.rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  function submit() {
    const parsed = eventSchema.safeParse(ev);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((is) => is.message));
      return;
    }
    setErrors([]);
    start(async () => {
      try {
        const result = await saveEvent(parsed.data);
        if (!result.ok) {
          setErrors([result.error]);
          return;
        }
        const { id } = result.data;
        setEv((e) => ({ ...e, id }));
        router.replace(`/admin/events/${id}`);
        router.refresh();
      } catch (e) {
        setErrors([e instanceof Error ? e.message : 'Save failed']);
      }
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{ev.id ? 'Edit event' : 'New event'}</h1>
      {ev.id && status && (
        <section className="space-y-2 rounded border p-3">
          <div className="text-sm">Status: <span className="font-semibold">{status.replace('_', ' ')}</span></div>
          <EventStatusButtons eventId={ev.id} status={status} />
        </section>
      )}

      <label className="block">
        <span className="text-sm font-medium">Event name</span>
        <input className={input} value={ev.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Season</span>
        <select className={input} value={ev.seasonId} onChange={(e) => set({ seasonId: e.target.value })}>
          <option value="">Choose season</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.year}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium">Event type</span>
          <select className={input} value={ev.eventType} onChange={(e) => set({ eventType: e.target.value as EventFormValue['eventType'] })}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Format</span>
          <select className={input} value={ev.format} onChange={(e) => set({ format: e.target.value as EventFormValue['format'] })}>
            <option value="stroke">Stroke</option>
            <option value="match_play">Match play</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Handicap mode</span>
          <select className={input} value={ev.handicapMode} onChange={(e) => set({ handicapMode: e.target.value as EventFormValue['handicapMode'] })}>
            <option value="net">Net</option>
            <option value="gross">Gross</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Allowance %</span>
          <input className={input} inputMode="numeric" value={Number.isNaN(ev.allowancePct) ? '' : ev.allowancePct}
            onChange={(e) => set({ allowancePct: e.target.value.trim() === '' ? NaN : Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Handicap basis</span>
          <select className={input} value={ev.handicapBasis ?? 'index'} onChange={(e) => set({ handicapBasis: e.target.value as 'index' | 'course' })}>
            <option value="index">Index</option>
            <option value="course">Course handicap</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Match strokes</span>
          <select className={input} value={ev.matchStrokes} onChange={(e) => set({ matchStrokes: e.target.value as EventFormValue['matchStrokes'] })}>
            <option value="full">Full</option>
            <option value="offLow">Off the low</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Registration deadline (Central time)</span>
        <input type="datetime-local" className={input}
          value={ev.registrationDeadline ? isoToCentralInput(ev.registrationDeadline) : ''}
          onChange={(e) => set({ registrationDeadline: e.target.value ? centralInputToIso(e.target.value) : '' })} />
      </label>

      {ev.rounds.map((r, i) => (
        <section key={i} className="space-y-3 rounded border p-3">
          <div className="font-semibold">
            Round {r.roundNumber}
            {ev.format === 'match_play' && r.roundNumber === 1 && <span className="ml-2 text-sm font-normal text-gray-600">(stroke play-in)</span>}
          </div>
          <label className="block">
            <span className="text-sm font-medium">Tee</span>
            <select className={input} value={r.teeId} onChange={(e) => setRound(i, { teeId: e.target.value })}>
              <option value="">Choose tee</option>
              {tees.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Play date</span>
            <input type="date" className={input} value={r.playDate ?? ''} onChange={(e) => setRound(i, { playDate: e.target.value || null })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Kind</span>
            <select className={input} value={ev.format === 'match_play' && r.roundNumber === 1 ? 'stroke' : r.kind}
              disabled={ev.format === 'match_play' && r.roundNumber === 1}
              onChange={(e) => setRound(i, { kind: e.target.value as 'stroke' | 'match' })}>
              <option value="stroke">Stroke</option>
              <option value="match">Match</option>
            </select>
          </label>
        </section>
      ))}
      <button type="button" className="min-h-[44px] w-full rounded border px-4 font-semibold"
        onClick={() => setEv((e) => ({
          ...e,
          rounds: [...e.rounds, { roundNumber: Math.max(0, ...e.rounds.map((r) => r.roundNumber)) + 1, teeId: '', playDate: null, kind: e.format === 'match_play' ? 'match' : 'stroke' }],
        }))}>
        Add round
      </button>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {errors.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      <button type="button" disabled={pending} onClick={submit}
        className="min-h-[44px] w-full rounded bg-green-700 px-4 font-semibold text-white disabled:opacity-50">
        {pending ? 'Saving…' : 'Save event'}
      </button>
    </div>
  );
}
