'use server';
import { z } from 'zod';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { ACT } from '@/lib/actionCodes';
import { eventSchema, type EventInput } from '@/lib/eventSchema';
import { EVENT_STATUSES, type EventStatus } from '@/lib/eventStatus';
import { transitionEventStatus } from '@/lib/eventTransition';

/**
 * Create or update an event (always starts as draft) and upsert its rounds by (event, round number).
 * A match-play event's round 1 is always the stroke-play play-in.
 */
export async function saveEvent(input: EventInput): Promise<ActionResult<{ id: string }>> {
  await requireCommissioner();
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

    let eventId = e.id;
    if (eventId) {
      const { data, error } = await admin.from('events').update(fields).eq('id', eventId).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new ActionError(ACT.notFound, 'Event not found');
    } else {
      const { data, error } = await admin.from('events').insert(fields).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Could not create event');
      eventId = data.id as string;
    }

    const { error } = await admin.from('rounds').upsert(
      e.rounds.map((r) => ({
        event_id: eventId,
        round_number: r.roundNumber,
        tee_id: r.teeId,
        play_date: r.playDate,
        kind: e.format === 'match_play' && r.roundNumber === 1 ? 'stroke' : r.kind,
      })),
      { onConflict: 'event_id,round_number' },
    );
    if (error) throw new Error(error.message);
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
