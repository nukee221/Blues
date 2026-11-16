import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// saveEvent / saveCourse edit locks against real tables (service role); only auth is stubbed.
const h = vi.hoisted(() => ({ admin: null as unknown, commissionerId: '' }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('@/lib/auth', () => ({ requireCommissioner: async () => ({ userId: 'u', player: { id: h.commissionerId } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.admin }));

import { saveEvent } from '@/actions/events';
import { saveCourse } from '@/actions/courses';
import { ACT } from '@/lib/actionCodes';

const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
h.admin = admin;

const stamp = Date.now();
const pars = [4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4];
const sis = [18, 4, 10, 8, 16, 12, 6, 14, 2, 3, 15, 11, 7, 1, 17, 5, 13, 9];
const holes = () => pars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i]! }));
let seasonId: string;
let courseId: string;
let teeId: string;
let eventId: string;
let roundId: string;
let groupId: string;

const eventInput = (over: Record<string, unknown> = {}) => ({
  id: eventId,
  seasonId,
  name: `INT locks ${stamp}`,
  eventType: 'regular' as const,
  format: 'stroke' as const,
  handicapMode: 'net' as const,
  allowancePct: 100,
  handicapBasis: 'index' as const,
  matchStrokes: 'full' as const,
  registrationDeadline: '2027-04-01T12:00:00.000Z',
  rounds: [{ roundNumber: 1, teeId, playDate: '2027-04-10', kind: 'stroke' as const }],
  ...over,
});
const courseInput = (teeOver: Record<string, unknown> = {}) => ({
  id: courseId,
  name: `INT Course ${stamp}`,
  tees: [{ id: teeId, name: 'Blue', rating: 71.8, slope: 140, par: 72, holes: holes(), ...teeOver }],
});

beforeAll(async () => {
  const { data: commish } = await admin.from('players').select('id').eq('email', 'player01@example.test').single();
  h.commissionerId = commish!.id;
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  seasonId = season!.id;
  const made = await saveCourse({ name: `INT Course ${stamp}`, tees: [{ name: 'Blue', rating: 71.8, slope: 140, par: 72, holes: holes() }] });
  if (!made.ok) throw new Error(made.error);
  courseId = made.data.id;
  teeId = made.data.teeIds[0]!;
  const ev = await saveEvent({ ...eventInput(), id: undefined });
  if (!ev.ok) throw new Error(ev.error);
  eventId = ev.data.id;
  const { data: round } = await admin.from('rounds').select('id').eq('event_id', eventId).single();
  roundId = round!.id;
  const { data: g, error } = await admin.from('groups').insert({ round_id: roundId }).select('id').single();
  if (error) throw error;
  groupId = g!.id;
});

afterAll(async () => {
  await admin.from('audit_log').delete().in('entity_id', [eventId, courseId, teeId].filter(Boolean));
  if (eventId) await admin.from('events').delete().eq('id', eventId);
  if (courseId) await admin.from('courses').delete().eq('id', courseId);
});

describe('edit locks against local Supabase', () => {
  it('an in_progress event refuses a handicap change, allows a rename, and audits it', async () => {
    await admin.from('events').update({ status: 'in_progress' }).eq('id', eventId);
    await expect(saveEvent(eventInput({ allowancePct: 90 }))).resolves.toMatchObject({ ok: false, code: ACT.eventLocked });
    await expect(saveEvent(eventInput({ rounds: [{ roundNumber: 1, teeId, playDate: '2027-04-11', kind: 'stroke' }] }))).resolves.toMatchObject({
      ok: false,
      code: ACT.eventLocked,
    });
    await expect(saveEvent(eventInput({ name: `INT locks renamed ${stamp}` }))).resolves.toMatchObject({ ok: true });
    const { data: ev } = await admin.from('events').select('name, allowance_pct, status').eq('id', eventId).single();
    expect(ev).toMatchObject({ name: `INT locks renamed ${stamp}`, allowance_pct: 100, status: 'in_progress' });
    const { data: audits } = await admin.from('audit_log').select('before, after').eq('entity', 'event').eq('entity_id', eventId);
    expect(audits).toHaveLength(1);
    expect(audits![0]).toMatchObject({ before: { name: `INT locks ${stamp}` }, after: { name: `INT locks renamed ${stamp}`, locked: true } });
  });

  it('a tee with a signed card refuses a slope / stroke-index change but allows a rename (action and DB)', async () => {
    await expect(saveCourse(courseInput({ slope: 141 }))).resolves.toMatchObject({ ok: true }); // card not signed yet
    await admin.from('groups').update({ locked: true, signed_at: new Date().toISOString() }).eq('id', groupId);

    await expect(saveCourse(courseInput({ slope: 139 }))).resolves.toMatchObject({ ok: false, code: ACT.teeLocked });
    const h2 = holes();
    h2[0]!.strokeIndex = 4;
    h2[1]!.strokeIndex = 18;
    await expect(saveCourse(courseInput({ slope: 141, holes: h2 }))).resolves.toMatchObject({ ok: false, code: ACT.teeLocked });
    await expect(saveCourse(courseInput({ slope: 141, name: 'Blue (2026)' }))).resolves.toMatchObject({ ok: true });
    const { data: tee } = await admin.from('tees').select('name, slope').eq('id', teeId).single();
    expect(tee).toEqual({ name: 'Blue (2026)', slope: 141 });
    const { data: hole1 } = await admin.from('holes').select('stroke_index').eq('tee_id', teeId).eq('number', 1).single();
    expect(hole1!.stroke_index).toBe(18);
    const { data: audits } = await admin.from('audit_log').select('before, after').eq('entity', 'tee').eq('entity_id', teeId);
    expect((audits ?? []).length).toBeGreaterThanOrEqual(3); // create, slope change, rename
  });
});
