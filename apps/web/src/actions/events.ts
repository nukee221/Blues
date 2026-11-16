'use server';
import { z } from 'zod';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { eventSchema, type EventInput, type EventParsed } from '@/lib/eventSchema';
import { loadEventRounds, RESULTS_STATUSES, type RoundRow } from '@/lib/editLocks';
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
 * The results-affecting fields that differ from what is stored, as labels. Stored nulls compare
 * as the form shows them (format null = stroke, mode null = net).
 */
function resultsChanges(current: EventRow, rounds: RoundRow[], e: EventParsed): string[] {
  const out: string[] = [];
  if (current.event_type !== e.eventType) out.push('event type');
  if ((current.format === 'match_play' ? 'match_play' : 'stroke') !== e.format) out.push('format');
  if ((current.handicap_mode === 'gross' ? 'gross' : 'net') !== e.handicapMode) out.push('handicap mode');
  if (current.allowance_pct !== e.allowancePct) out.push('allowance');
  if (current.handicap_basis !== e.handicapBasis) out.push('handicap basis');
  if (current.match_strokes !== e.matchStrokes) out.push('match strokes');
  for (const r of e.rounds) {
    const prev = rounds.find((x) => x.round_number === r.roundNumber);
    if (!prev) continue; // a new round has no results yet
    if (prev.tee_id !== r.teeId) out.push(`round ${r.roundNumber} tee`);
    if (prev.kind !== effectiveKind(e.format, r.roundNumber, r.kind)) out.push(`round ${r.roundNumber} kind`);
  }
  return out;
}

/**
 * Create or update an event (always starts as draft) and upsert its rounds by (event, round number).
 * A match-play event's round 1 is always the stroke-play play-in.
 *
 * Every field stays editable in every status (mistakes are found late). A save of a non-draft
 * event is audited with before/after. When the event is in_progress or final and a
 * results-affecting field changed (handicap mode, allowance, basis, match strokes, format,
 * event type, a round's tee or kind), the save needs `confirmResultsChange: true`; without it
 * the result is 'needs_confirm' (listing the fields) and nothing is written.
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
    const rounds = await loadEventRounds(admin, eventId);

    const changed = resultsChanges(current, rounds, e);
    const live = (RESULTS_STATUSES as readonly string[]).includes(current.status);
    if (live && changed.length && e.confirmResultsChange !== true) {
      throw new ActionError(
        ACT.needsConfirm,
        `This changes results already recorded for this event (${changed.join(', ')}). Confirm to save.`,
        changed,
      );
    }

    // Conditional on the status read, so a concurrent start/finalize cannot slip past the check.
    const { data: updated, error } = await admin
      .from('events')
      .update(fields)
      .eq('id', eventId)
      .eq('status', current.status)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new ActionError(ACT.statusConflict, 'Event status changed concurrently; reload and retry');

    const { error: rErr } = await admin.from('rounds').upsert(roundRows(eventId), { onConflict: 'event_id,round_number' });
    if (rErr) throw new Error(rErr.message);

    if (current.status !== 'draft') {
      const afterRounds = rounds.map((prev) => {
        const r = e.rounds.find((x) => x.roundNumber === prev.round_number);
        if (!r) return prev;
        return { ...prev, tee_id: r.teeId, play_date: r.playDate, kind: effectiveKind(e.format, r.roundNumber, r.kind) };
      });
      for (const r of roundRows(eventId)) {
        if (!afterRounds.some((x) => x.round_number === r.round_number)) afterRounds.push({ id: '', ...r });
      }
      const { error: aErr } = await admin.from('audit_log').insert({
        actor_player_id: player.id,
        entity: 'event',
        entity_id: eventId,
        before: { ...snapshot(current, rounds), status: current.status },
        after: {
          ...snapshot({ ...current, ...fields }, afterRounds),
          status: current.status,
          action: 'save_event',
          results_changed: changed,
          confirmed_results_change: live && changed.length > 0,
        },
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
