'use server';
import { z } from 'zod';
import { requireCommissioner } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventSchema, type EventInput } from '@/lib/eventSchema';
import { EVENT_STATUSES, canTransition, type EventStatus } from '@/lib/eventStatus';

/**
 * Create or update an event (always starts as draft) and upsert its rounds by (event, round number).
 * A match-play event's round 1 is always the stroke-play play-in.
 */
export async function saveEvent(input: EventInput): Promise<{ id: string }> {
  await requireCommissioner();
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
    if (!data) throw new Error('Event not found');
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
}

/** Move an event through its lifecycle; only allowed transitions, each audited. */
export async function setEventStatus(eventId: string, to: EventStatus): Promise<void> {
  const { player } = await requireCommissioner();
  z.string().uuid().parse(eventId);
  z.enum(EVENT_STATUSES).parse(to);
  const admin = createAdminClient();

  const { data: current, error: readError } = await admin
    .from('events')
    .select('id, status')
    .eq('id', eventId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error('Event not found');
  const from = current.status as EventStatus;
  if (!canTransition(from, to)) throw new Error(`Cannot move an event from ${from} to ${to}`);

  // Guard on the status we read so a concurrent change cannot be overwritten.
  const { data: updated, error } = await admin
    .from('events')
    .update({ status: to })
    .eq('id', eventId)
    .eq('status', from)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Event status changed concurrently; reload and retry');

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_player_id: player.id,
    entity: 'event',
    entity_id: eventId,
    before: { status: from },
    after: { status: to },
  });
  if (auditError) throw new Error(auditError.message);
}
