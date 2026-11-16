'use server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireCommissioner, requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { normalizeCode } from '@/lib/codes';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { loadCard, type CardData } from '@/lib/cardData';
import { cardCompletion } from '@/lib/cardCompletion';
import { SG, type SignRole } from '@/lib/signingCodes';

/**
 * Two-person card signing. The scorer (groups.scorer_player_id) and an attester (another
 * player in the group; in match rounds the scorer's opponent) each sign with their own
 * 4-digit PIN, from any device holding the group code. The card locks when both roles
 * are signed (sign_card, one transaction); a locked card's scores change only through
 * the commissioner (admin_edit_score, audited). See supabase/migrations/0004.
 */

const PIN_RE = /^\d{4}$/;
const BCRYPT_COST = 10;
const NO_PIN = 'Set your PIN in the app (Me → PIN). The commissioner can also sign for you.';

const pinSchema = z.string().regex(PIN_RE, 'PIN must be exactly 4 digits');
const roleSchema = z.enum(['scorer', 'attest'], 'Role must be scorer or attest');
const uuid = z.string().uuid('Invalid id');

type Admin = ReturnType<typeof createAdminClient>;
type Group = { id: string; round_id: string; start_hole: number; scorer_player_id: string | null; locked: boolean; signed_at: string | null };
const GROUP_COLS = 'id, round_id, start_hole, scorer_player_id, locked, signed_at';

/** Map the SQLSTATEs raised by the 0004 functions to signing codes. */
function rpcError(e: { code?: string; message: string }): Error {
  switch (e.code) {
    case 'HGLCK':
      return new ActionError(SG.locked, 'Card is already signed');
    case 'HGNFD':
      return new ActionError(SG.notFound, 'Group not found');
    case 'HGNIG':
      return new ActionError(SG.notInGroup, 'That player is not in this group');
    case 'HGROL':
      return new ActionError(SG.notGroupScorer, 'Only the group’s scorer signs as scorer');
    case 'HGSAM':
      return new ActionError(SG.sameAsScorer, 'The attester must be a different player from the scorer');
    case 'HGNLK':
      return new ActionError(SG.notSigned, 'This card has no signatures to reopen');
    case '23505':
      return new ActionError(SG.alreadySigned, 'Another player already signed that role');
    default:
      return new Error(e.message);
  }
}

async function groupBy(admin: Admin, column: 'code' | 'id', value: string): Promise<Group> {
  const { data, error } = await admin.from('groups').select(GROUP_COLS).eq(column, value).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(SG.notFound, column === 'code' ? 'No group has that code' : 'Group not found');
  return data as Group;
}

/**
 * Who may sign which role, and whether the card is complete. Same rules for players
 * (signCard) and the commissioner (adminSignCard). Checks run in order: locked, role,
 * opponent (match), completeness.
 */
async function checkSignable(admin: Admin, group: Group, playerId: string, role: SignRole): Promise<CardData> {
  if (group.locked || group.signed_at) throw new ActionError(SG.locked, 'Card is already signed');
  const card = await loadCard(admin, group);
  if (!card.players.some((p) => p.id === playerId)) throw new ActionError(SG.notInGroup, 'That player is not in this group');
  const scorer = group.scorer_player_id;
  const signedOther = card.signatures.find((s) => s.playerId === playerId && s.role !== role);
  if (role === 'scorer') {
    if (!scorer) throw new ActionError(SG.noScorer, 'This group has no scorer yet');
    if (playerId !== scorer) throw new ActionError(SG.notGroupScorer, 'Only the group’s scorer signs as scorer');
    if (signedOther) throw new ActionError(SG.sameAsScorer, 'The scorer and the attester must be different players');
  } else {
    if (playerId === scorer || signedOther) {
      throw new ActionError(SG.sameAsScorer, 'The attester must be a different player from the scorer');
    }
    if (card.round.kind === 'match') {
      if (!scorer) throw new ActionError(SG.noScorer, 'This group has no scorer yet, so there is no opponent to attest');
      // Two-player match: the opponent is the other player. Otherwise there is no defined opponent.
      const opponent = card.players.length === 2 ? card.players.find((p) => p.id !== scorer)?.id : undefined;
      if (playerId !== opponent) throw new ActionError(SG.notOpponent, 'In match play the opponent attests the card');
    }
  }
  const taken = card.signatures.find((s) => s.role === role);
  if (taken && taken.playerId !== playerId) throw new ActionError(SG.alreadySigned, `${taken.name} already signed`);
  const done = cardCompletion({
    kind: card.round.kind,
    players: card.players,
    holes: card.holes,
    scores: card.scores,
    startHole: group.start_hole,
    matchStrokes: card.event.matchStrokes,
  });
  if (!done.complete) throw new ActionError(done.code, done.message);
  return card;
}

/** Logged-in player sets or changes their own 4-digit signing PIN. */
export async function setPin(pin: string): Promise<ActionResult<null>> {
  const { player } = await requireUser();
  return toResult(async () => {
    const p = pinSchema.parse(pin);
    const hash = await bcrypt.hash(p, BCRYPT_COST);
    // The user's own client: RLS (players_update_own + the pin_hash column grant) limits this to their row.
    const supabase = await createServerClient();
    const { data, error } = await supabase.from('players').update({ pin_hash: hash }).eq('id', player.id).select('id');
    if (error) throw new Error(error.message);
    if ((data ?? []).length !== 1) throw new ActionError(SG.notFound, 'Your player record was not found');
    return null;
  });
}

/**
 * Sign a card as `role` with `playerId`'s PIN. No login: the group code opens the card,
 * the PIN proves who is signing. Five wrong PINs in ten minutes block that player for
 * ten minutes from the fifth (pin_locked), even for a correct PIN.
 */
export async function signCard(code: string, playerId: string, pin: string, role: SignRole): Promise<ActionResult<{ locked: boolean }>> {
  return toResult(async () => {
    const c = normalizeCode(code);
    if (!c) throw new ActionError(SG.invalid, 'That is not a valid code');
    const pid = uuid.parse(playerId);
    const r = roleSchema.parse(role);
    const p = pinSchema.parse(pin);
    const admin = createAdminClient();
    const group = await groupBy(admin, 'code', c);
    await checkSignable(admin, group, pid, r);

    const { data: who, error: whoError } = await admin.from('players').select('pin_hash').eq('id', pid).maybeSingle();
    if (whoError) throw new Error(whoError.message);
    const hash = (who as { pin_hash: string | null } | null)?.pin_hash;
    if (!hash) throw new ActionError(SG.noPin, NO_PIN);

    // Reserve the attempt (recorded as a failure) before comparing, so parallel guesses all count.
    const { data: attempt, error: beginError } = await admin.rpc('pin_attempt_begin', { p_player: pid });
    if (beginError) throw new Error(beginError.message);
    if (!attempt) throw new ActionError(SG.pinLocked, 'Too many wrong PINs. Try again in 10 minutes or ask the commissioner.');
    if (!(await bcrypt.compare(p, hash).catch(() => false))) throw new ActionError(SG.wrongPin, 'Wrong PIN');
    const { error: okError } = await admin.rpc('pin_attempt_succeeded', { p_attempt: attempt });
    if (okError) throw new Error(okError.message);

    const { data: locked, error } = await admin.rpc('sign_card', { p_group: group.id, p_player: pid, p_role: r });
    if (error) throw rpcError(error);
    return { locked: locked === true };
  });
}

/** Commissioner signs for a player (no PIN, e.g. no PIN set). Same role and completeness rules; audited. */
export async function adminSignCard(groupId: string, playerId: string, role: SignRole): Promise<ActionResult<{ locked: boolean }>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const gid = uuid.parse(groupId);
    const pid = uuid.parse(playerId);
    const r = roleSchema.parse(role);
    const admin = createAdminClient();
    const group = await groupBy(admin, 'id', gid);
    await checkSignable(admin, group, pid, r);
    const { data: locked, error } = await admin.rpc('admin_sign_card', { p_group: gid, p_player: pid, p_role: r, p_actor: player.id });
    if (error) throw rpcError(error);
    return { locked: locked === true };
  });
}

/** Commissioner: unlock a signed card, clear its signatures; audit row with the reason. */
export async function reopenCard(groupId: string, reason: string): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const gid = uuid.parse(groupId);
    const why = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500).parse(reason);
    const admin = createAdminClient();
    const { error } = await admin.rpc('reopen_card', { p_group: gid, p_actor: player.id, p_reason: why });
    if (error) throw rpcError(error);
    return null;
  });
}

/** Commissioner: set one gross, locked card or not; audit row with before/after. */
export async function adminEditScore(groupId: string, playerId: string, hole: number, gross: number): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const gid = uuid.parse(groupId);
    const pid = uuid.parse(playerId);
    const h = z.number().int('Hole must be a whole number').min(1, 'Hole must be 1–36').max(36, 'Hole must be 1–36').parse(hole);
    const g = z.number().int('Gross must be a whole number').min(1, 'Gross must be 1–15').max(15, 'Gross must be 1–15').parse(gross);
    const admin = createAdminClient();
    const group = await groupBy(admin, 'id', gid);
    const card = await loadCard(admin, group);
    if (!card.players.some((p) => p.id === pid)) throw new ActionError(SG.notInGroup, 'That player is not in this group');
    if (h > 18 && card.round.kind !== 'match') throw new ActionError(SG.invalid, 'Extra holes are for match play only');
    if (!card.holes.some((x) => x.number === (h > 18 ? ((h - 1) % 18) + 1 : h))) throw new ActionError(SG.invalid, 'That hole is not on this tee');
    const { error } = await admin.rpc('admin_edit_score', { p_group: gid, p_player: pid, p_hole: h, p_gross: g, p_actor: player.id });
    if (error) throw rpcError(error);
    return null;
  });
}
