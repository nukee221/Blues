import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { localSupabase } from './supabaseEnv';

// Real tables, RPCs, trigger and bcrypt via the service role; only cookies and the
// signed-in user are stubbed.
const h = vi.hoisted(() => ({ admin: null as unknown, jar: new Map<string, string>(), me: '' as string, commish: '' as string }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
  }),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ userId: 'u', player: { id: h.me } }),
  requireCommissioner: async () => ({ userId: 'c', player: { id: h.commish } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => h.admin }));

import { claimScorer, openGroup, saveScores, type ScoreInput } from '@/actions/scorecard';
import { adminEditScore, reopenCard, setPin, signCard } from '@/actions/signing';
import { generateGroupCode } from '@/lib/codes';
import type { ActionResult } from '@/lib/actionResult';
import { SC } from '@/lib/scorecardCodes';
import { SG } from '@/lib/signingCodes';

function data<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r.data;
}
const codeOf = (r: ActionResult<unknown>) => (r.ok ? 'ok' : r.code);

const env = localSupabase();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
h.admin = admin;

const stamp = Date.now();
const code = generateGroupCode();
let eventId: string;
let groupId: string;
let scorer: string;
let marker: string;
let original: { id: string; pin_hash: string | null }[] = [];
let clock = Date.now() - 60_000;
const ts = () => new Date((clock += 1000)).toISOString();

beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id').limit(1).single();
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `INT signing ${stamp}`, event_type: 'regular', status: 'in_progress', handicap_mode: 'net' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: round, error: rErr } = await admin
    .from('rounds')
    .insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, kind: 'stroke' })
    .select('id')
    .single();
  if (rErr) throw rErr;
  const { data: ps } = await admin
    .from('players')
    .select('id, email, pin_hash')
    .in('email', ['player08@example.test', 'player09@example.test', 'player01@example.test'])
    .order('email');
  const [commish, p8, p9] = ps!;
  h.commish = commish!.id;
  scorer = p8!.id;
  marker = p9!.id;
  original = [p8!, p9!].map((p) => ({ id: p.id, pin_hash: p.pin_hash }));
  await admin.from('pin_attempts').delete().in('player_id', [scorer, marker]);
  await admin.from('pin_blocks').delete().in('player_id', [scorer, marker]);
  const { data: group, error: gErr } = await admin.from('groups').insert({ round_id: round!.id, code, scorer_player_id: scorer }).select('id').single();
  if (gErr) throw gErr;
  groupId = group!.id;
  const gp = await admin.from('group_players').insert([scorer, marker].map((p) => ({ group_id: groupId, player_id: p, playing_handicap: 5 })));
  if (gp.error) throw gp.error;
});

afterAll(async () => {
  if (eventId) await admin.from('events').delete().eq('id', eventId);
  for (const p of original) await admin.from('players').update({ pin_hash: p.pin_hash }).eq('id', p.id);
  if (scorer) {
    await admin.from('pin_attempts').delete().in('player_id', [scorer, marker]);
    await admin.from('pin_blocks').delete().in('player_id', [scorer, marker]);
  }
  if (groupId) {
    await admin.from('audit_log').delete().eq('entity_id', groupId);
    await admin.from('audit_log').delete().eq('after->>group_id', groupId);
  }
});

const holes = (player: string, from: number, to: number, gross = 4): ScoreInput[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ playerId: player, hole: from + i, gross, clientTs: ts() }));

describe('signing against local Supabase', () => {
  it('scores → both sign → locked → saveScores refused → admin edit (audited) → reopen → saveScores works', async () => {
    h.me = scorer;
    data(await setPin('1357'));
    h.me = marker;
    data(await setPin('2468'));
    const { data: hashes } = await admin.from('players').select('pin_hash').in('id', [scorer, marker]);
    for (const row of hashes!) expect(row.pin_hash).toMatch(/^\$2[aby]\$10\$/);

    h.jar.clear();
    data(await openGroup(code));
    data(await claimScorer(code, scorer));
    data(await saveScores(code, [...holes(scorer, 1, 18), ...holes(marker, 1, 17)]));
    expect(codeOf(await signCard(code, scorer, '1357', 'scorer'))).toBe(SG.incomplete);
    data(await saveScores(code, holes(marker, 18, 18, 5)));

    expect(codeOf(await signCard(code, scorer, '0000', 'scorer'))).toBe(SG.wrongPin);
    expect(data(await signCard(code, scorer, '1357', 'scorer'))).toEqual({ locked: false });
    expect(codeOf(await signCard(code, scorer, '1357', 'attest'))).toBe(SG.sameAsScorer);

    // The attester signs from their own phone (no scorer cookie).
    const scorerJar = new Map(h.jar);
    h.jar.clear();
    expect(data(await signCard(code, marker, '2468', 'attest'))).toEqual({ locked: true });
    const { data: g } = await admin.from('groups').select('locked, signed_at').eq('id', groupId).single();
    expect(g!.locked).toBe(true);
    expect(g!.signed_at).not.toBeNull();
    const view = data(await openGroup(code));
    expect(view.locked).toBe(true);
    expect(view.signatures!.map((s) => [s.role, s.playerId])).toEqual([
      ['scorer', scorer],
      ['attest', marker],
    ]);

    // Locked: the scorer phone is refused, and so is a direct write (trigger).
    for (const [k, v] of scorerJar) h.jar.set(k, v);
    expect(codeOf(await saveScores(code, holes(scorer, 1, 1, 3)))).toBe(SC.locked);
    const direct = await admin.from('scores').update({ gross: 2 }).eq('group_id', groupId).eq('hole', 1);
    expect(direct.error?.code).toBe('HGLCK');

    // Commissioner edit on the locked card is audited with before/after.
    data(await adminEditScore(groupId, marker, 18, 4));
    const { data: edited } = await admin.from('scores').select('gross').eq('group_id', groupId).eq('player_id', marker).eq('hole', 18).single();
    expect(edited!.gross).toBe(4);
    const { data: scoreAudit } = await admin
      .from('audit_log')
      .select('actor_player_id, before, after')
      .eq('entity', 'score')
      .eq('after->>group_id', groupId);
    expect(scoreAudit).toEqual([
      { actor_player_id: h.commish, before: expect.objectContaining({ gross: 5, hole: 18 }), after: expect.objectContaining({ gross: 4, hole: 18 }) },
    ]);

    expect(codeOf(await reopenCard(groupId, 'no'))).toBe(SG.invalid);
    data(await reopenCard(groupId, 'Marker score on 18'));
    const { data: reopened } = await admin.from('groups').select('locked, signed_at').eq('id', groupId).single();
    expect(reopened).toEqual({ locked: false, signed_at: null });
    const { data: left } = await admin.from('signatures').select('id').eq('group_id', groupId);
    expect(left).toEqual([]);
    const { data: groupAudit } = await admin.from('audit_log').select('actor_player_id, after').eq('entity', 'group').eq('entity_id', groupId);
    expect(groupAudit).toEqual([{ actor_player_id: h.commish, after: expect.objectContaining({ locked: false, reason: 'Marker score on 18' }) }]);

    expect(data(await saveScores(code, holes(scorer, 1, 1, 3)))).toEqual({ accepted: 1, rejected: [] });
  });

  it('five wrong PINs block the 6th attempt even with the right PIN', async () => {
    await admin.from('pin_attempts').delete().eq('player_id', marker);
    data(await signCard(code, scorer, '1357', 'scorer'));
    for (let i = 0; i < 5; i++) expect(codeOf(await signCard(code, marker, '1111', 'attest'))).toBe(SG.wrongPin);
    expect(codeOf(await signCard(code, marker, '2468', 'attest'))).toBe(SG.pinLocked);
    const { data: g } = await admin.from('groups').select('locked').eq('id', groupId).single();
    expect(g!.locked).toBe(false);
    // Backdate the failures past the window: the block lifts.
    await admin.from('pin_attempts').update({ attempted_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('player_id', marker);
    const { data: blocks } = await admin.from('pin_blocks').select('blocked_at, until').eq('player_id', marker);
    expect(blocks).toHaveLength(1);
    expect(Date.parse(blocks![0]!.until) - Date.parse(blocks![0]!.blocked_at)).toBe(10 * 60_000);
    await admin.from('pin_blocks').update({ blocked_at: new Date(Date.now() - 11 * 60_000).toISOString(), until: new Date(Date.now() - 60_000).toISOString() }).eq('player_id', marker);
    expect(data(await signCard(code, marker, '2468', 'attest'))).toEqual({ locked: true });
  });

  it('changing the scorer of an unlocked card clears its signatures (as saveGroups does)', async () => {
    data(await reopenCard(groupId, 'scorer change test'));
    data(await signCard(code, scorer, '1357', 'scorer'));
    const { error } = await admin.from('groups').update({ scorer_player_id: marker }).eq('id', groupId);
    expect(error).toBeNull();
    const { data: left } = await admin.from('signatures').select('id').eq('group_id', groupId);
    expect(left).toEqual([]);
  });
});
