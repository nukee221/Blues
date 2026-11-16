import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// "Take over scoring" against real tables, RPCs and the scorer-change trigger; only cookies and the
// signed-in user (for setPin) are stubbed.
const h = vi.hoisted(() => ({ admin: null as unknown, jar: new Map<string, string>(), me: '' }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
  }),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ userId: 'u', player: { id: h.me } }),
  requireCommissioner: async () => ({ userId: 'c', player: { id: h.me } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.admin }));

import { claimScorer, saveScores, takeOverScoring } from '@/actions/scorecard';
import { setPin } from '@/actions/signing';
import { generateGroupCode } from '@/lib/codes';
import type { ActionResult } from '@/lib/actionResult';
import { SC } from '@/lib/scorecardCodes';
import { SG } from '@/lib/signingCodes';

const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);
const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
h.admin = admin;

const stamp = Date.now();
const code = generateGroupCode();
const OLD = 'O'.repeat(43);
const NEW = 'N'.repeat(43);
let eventId = '';
let groupId = '';
let a = '';
let b = '';
let original: { id: string; pin_hash: string | null }[] = [];
const entry = (player: string, hole: number) => ({ playerId: player, hole, gross: 4, clientTs: new Date().toISOString() });

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id').limit(1).single();
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT takeover ${stamp}`, event_type: 'regular', status: 'in_progress', handicap_mode: 'net' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: round } = await admin.from('rounds').insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, kind: 'stroke' }).select('id').single();
  const { data: ps } = await admin.from('players').select('id, pin_hash').in('email', ['player10@example.test', 'player11@example.test']).order('email');
  [a, b] = ps!.map((p) => p.id);
  original = ps!.map((p) => ({ id: p.id!, pin_hash: p.pin_hash }));
  await admin.from('pin_attempts').delete().in('player_id', [a, b]);
  await admin.from('pin_blocks').delete().in('player_id', [a, b]);
  const { data: g, error: gErr } = await admin.from('groups').insert({ round_id: round!.id, code }).select('id').single();
  if (gErr) throw gErr;
  groupId = g!.id;
  await admin.from('group_players').insert([a, b].map((p) => ({ group_id: groupId, player_id: p, playing_handicap: 5 })));
  h.me = a;
  await setPin('1357');
  h.me = b;
  await setPin('2468');
});

afterAll(async () => {
  if (eventId) await admin.from('events').delete().eq('id', eventId);
  for (const p of original) await admin.from('players').update({ pin_hash: p.pin_hash }).eq('id', p.id);
  await admin.from('pin_attempts').delete().in('player_id', [a, b]);
  await admin.from('pin_blocks').delete().in('player_id', [a, b]);
  if (groupId) await admin.from('audit_log').delete().eq('entity_id', groupId);
});

describe('take over scoring against local Supabase', () => {
  it('correct PIN takes over; wrong PIN refused; the old phone gets not_scorer; a locked card refuses', async () => {
    h.jar.set('hgt_dev', OLD);
    expect(codeOf(await claimScorer(code, a))).toBe('ok');
    expect(codeOf(await saveScores(code, [entry(a, 1)]))).toBe('ok');
    // a partial signature from the first scorer's era must be cleared by the scorer change
    await admin.from('signatures').insert({ group_id: groupId, player_id: a, role: 'scorer' });

    h.jar.set('hgt_dev', NEW);
    expect(codeOf(await takeOverScoring(code, b, '0000'))).toBe(SG.wrongPin);
    const { data: still } = await admin.from('groups').select('scorer_player_id, scorer_device_token').eq('id', groupId).single();
    expect(still).toMatchObject({ scorer_player_id: a, scorer_device_token: OLD });

    const r = await takeOverScoring(code, b, '2468');
    expect(r).toEqual({ ok: true, data: { scorerName: expect.any(String) } });
    const { data: now } = await admin.from('groups').select('scorer_player_id, scorer_device_token, scorer_self_claimed').eq('id', groupId).single();
    expect(now).toEqual({ scorer_player_id: b, scorer_device_token: NEW, scorer_self_claimed: true });
    const { data: sigs } = await admin.from('signatures').select('id').eq('group_id', groupId);
    expect(sigs).toEqual([]);
    const { data: audits } = await admin.from('audit_log').select('after').eq('entity_id', groupId);
    expect(audits!.some((x) => (x.after as { action?: string })?.action === 'take_over_scoring')).toBe(true);

    expect(codeOf(await saveScores(code, [entry(b, 2)]))).toBe('ok'); // new phone
    h.jar.set('hgt_dev', OLD);
    expect(codeOf(await saveScores(code, [entry(a, 3)]))).toBe(SC.notScorer); // old phone

    // a player with no PIN, then a locked card
    await admin.from('players').update({ pin_hash: null }).eq('id', a);
    h.jar.set('hgt_dev', OLD);
    expect(codeOf(await takeOverScoring(code, a, '1357'))).toBe(SG.noPin);
    await admin.from('groups').update({ locked: true, signed_at: new Date().toISOString() }).eq('id', groupId);
    expect(codeOf(await takeOverScoring(code, b, '2468'))).toBe(SC.locked);
  });
});
