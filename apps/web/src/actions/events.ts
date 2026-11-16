'use server';
import { z } from 'zod';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { eventSchema, type EventInput, type EventParsed } from '@/lib/eventSchema';
import { eventIsLocked, loadEventLockState, type EventLockState, type RoundRow } from '@/lib/editLocks';
import { EVENT_STATUSES, type EventStatus } from '@/lib/eventStatus';
import { transitionEventStatus } from '@/lib/eventTransition';

type EventRow = {
  id: string;
  season_id: string;
  name: string;
  event_type: string;
  format: string | null;
  status: string;
  handicap_mode: string | null;
  allowance_pct: number;
  handicap_basis: string;
  match_strokes: string;
  registration_deadline: string | null;
};
const EVENT_COLS =
  'id, season_id, name, event_type, format, status, handicap_mode, allowance_pct, handicap_basis, match_strokes, registration_deadline';

const effectiveKind = (format: string, roundNumber: number, kind: 'stroke' | 'match') =>
  format === 'match_play' && roundNumber === 1 ? 'stroke' : kind;

/** What an audit row records of an event and its rounds. */
function snapshot(ev: Omit<EventRow, 'id' | 'status'>, rounds: Omit<RoundRow, 'id'>[]) {
  return {
    season_id: ev.season_id,
    name: ev.name,
    event_type: ev.event_type,
    format: ev.format,
    handicap_mode: ev.handicap_mode,
    allowance_pct: ev.allowance_pct,
    handicap_basis: ev.handicap_basis,
    match_strokes: ev.match_strokes,
    registration_deadline: ev.registration_deadline,
    rounds: [...rounds]
      .sort((a, b) => a.round_number - b.round_number)
      .map((r) => ({ round_number: r.round_number, tee_id: r.tee_id, play_date: r.play_date, kind: r.kind })),
  };
}

/**
 * The changes a locked event refuses, as labels (empty: the save may go ahead). Allowed:
 * the name, the registration deadline, and the play date of a round with no groups.
 * Stored nulls compare as the form shows them (format null = stroke, mode null = net).
 */
function lockedChanges(current: EventRow, state: EventLockState, e: EventParsed): string[] {
  const out: string[] = [];
  if (current.season_id !== e.seasonId) out.push('season');
  if (current.event_type !== e.eventType) out.push('event type');
  if ((current.format === 'match_play' ? 'match_play' : 'stroke') !== e.format) out.push('format');
  if ((current.handicap_mode === 'gross' ? 'gross' : 'net') !== e.handicapMode) out.push('handicap mode');
  if (current.allowance_pct !== e.allowancePct) out.push('allowance');
  if (current.handicap_basis !== e.handicapBasis) out.push('handicap basis');
  if (current.match_strokes !== e.matchStrokes) out.push('match strokes');
  for (const r of e.rounds) {
    const prev = state.rounds.find((x) => x.round_number === r.roundNumber);
    if (!prev) {
      out.push(`new round ${r.roundNumber}`);
      continue;
    }
    if (prev.tee_id !== r.teeId) out.push(`round ${r.roundNumber} tee`);
    if (prev.kind !== effectiveKind(e.format, r.roundNumber, r.kind)) out.push(`round ${r.roundNumber} kind`);
    if ((prev.play_date ?? null) !== (r.playDate ?? null) && state.roundsWithGroups.has(prev.id)) {
      out.push(`round ${r.roundNumber} date (it has groups)`);
    }
  }
  return out;
}

/**
 * Create or update an event (always starts as draft) and upsert its rounds by (event, round number).
 * A match-play event's round 1 is always the stroke-play play-in.
 *
 * Once the event is in_progress or final, or any of its cards is signed, results derive
 * from these settings, so only the name, the registration deadline and the play date of a
 * round without groups may change; anything else returns 'event_locked'. Every save of a
 * non-draft event writes an audit row with before/after.
 */
export async function saveEvent(input: EventInput): Promise<ActionResult<{ id: string }>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const e = eventSchema.parse(input); // validate before any DB call
    const admin = createAdminClient();

    const fields = {
      season_id: e.seasonId,
      name: e.name,
      event_type: e.eventType,
      format: e.format,
      handicap_mode: e.handicapMode,
      allowance_pct: e.allowancePct,
      handicap_basis: e.handicapBasis,
      match_strokes: e.matchStrokes,
      registration_deadline: e.registrationDeadline,
    };
    const roundRows = (eventId: string) =>
      e.rounds.map((r) => ({
        event_id: eventId,
        round_number: r.roundNumber,
        tee_id: r.teeId,
        play_date: r.playDate,
        kind: effectiveKind(e.format, r.roundNumber, r.kind),
      }));

    if (!e.id) {
      const { data, error } = await admin.from('events').insert(fields).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Could not create event');
      const eventId = data.id as string;
      const { error: rErr } = await admin.from('rounds').upsert(roundRows(eventId), { onConflict: 'event_id,round_number' });
      if (rErr) throw new Error(rErr.message);
      return { id: eventId };
    }

    const eventId = e.id;
    const { data: cur, error: readErr } = await admin.from('events').select(EVENT_COLS).eq('id', eventId).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new ActionError(ACT.notFound, 'Event not found');
    const current = cur as EventRow;
    const state = await loadEventLockState(admin, eventId);
    const locked = eventIsLocked(current.status, state);

    if (locked) {
      const refused = lockedChanges(current, state, e);
      if (refused.length) {
        throw new ActionError(
          ACT.eventLocked,
          `Scoring has started, so only the name, registration deadline and the date of a round without groups can change. Not saved: ${refused.join(', ')}.`,
        );
      }
    }

    // Conditional on the status read, so a concurrent start/finalize cannot slip past the lock.
    const patch = locked ? { name: e.name, registration_deadline: e.registrationDeadline } : fields;
    const { data: updated, error } = await admin
      .from('events')
      .update(patch)
      .eq('id', eventId)
      .eq('status', current.status)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new ActionError(ACT.statusConflict, 'Event status changed concurrently; reload and retry');

    if (locked) {
      for (const r of e.rounds) {
        const prev = state.rounds.find((x) => x.round_number === r.roundNumber)!;
        if ((prev.play_date ?? null) === (r.playDate ?? null)) continue;
        const { error: dErr } = await admin.from('rounds').update({ play_date: r.playDate }).eq('id', prev.id);
        if (dErr) throw new Error(dErr.message);
      }
    } else {
      const { error: rErr } = await admin.from('rounds').upsert(roundRows(eventId), { onConflict: 'event_id,round_number' });
      if (rErr) throw new Error(rErr.message);
    }

    if (current.status !== 'draft') {
      const afterRounds = state.rounds.map((prev) => {
        const r = e.rounds.find((x) => x.roundNumber === prev.round_number);
        if (!r) return prev;
        return locked
          ? { ...prev, play_date: r.playDate }
          : { ...prev, tee_id: r.teeId, play_date: r.playDate, kind: effectiveKind(e.format, r.roundNumber, r.kind) };
      });
      for (const r of roundRows(eventId)) {
        if (!afterRounds.some((x) => x.round_number === r.round_number)) afterRounds.push({ id: '', ...r });
      }
      const after = locked
        ? { ...current, name: e.name, registration_deadline: e.registrationDeadline }
        : { ...current, ...fields };
      const { error: aErr } = await admin.from('audit_log').insert({
        actor_player_id: player.id,
        entity: 'event',
        entity_id: eventId,
        before: { ...snapshot(current, state.rounds), status: current.status },
        after: { ...snapshot(after, afterRounds), status: current.status, action: 'save_event', locked },
      });
      if (aErr) throw new Error(aErr.message);
    }
    return { id: eventId };
  });
}

/**
 * Move an event through its lifecycle; only allowed transitions, each audited
 * (transitionEventStatus). in_progress -> final goes through finalizeEvent (actions/points),
 * which awards the points first: here it is refused with 'use_finalize'.
 */
export async function setEventStatus(eventId: string, to: EventStatus): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    z.string().uuid().parse(eventId);
    z.enum(EVENT_STATUSES).parse(to);
    await transitionEventStatus(createAdminClient(), player.id, eventId, to, (from) => {
      if (to === 'final') throw new ActionError(ACT.useFinalize, `Finalize the event to award points (${from} -> final)`);
    });
    return null;
  });
}
