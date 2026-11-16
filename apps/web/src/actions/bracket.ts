'use server';
import { z } from 'zod';
import { advanceCount, drawBracket, playInCut, playingHandicap, recordWinner, type Bracket, type HoleInfo } from '@hgt/scoring';
import { requireCommissioner, requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { ActionError, toResult, type ActionResult } from '@/lib/actionResult';
import { getTeeInfo } from '@/lib/courses';
import { assignCode } from '@/lib/groupCode';
import { getMailer, type MailMessage } from '@/lib/mailer';
import { playInBoard } from '@/lib/playIn';
import { centralInputToIso, formatRoundDate } from '@/lib/time';
import { BR, cryptoRng, isMatchKey, parseState } from '@/lib/bracketState';
import { describeMatch, type MatchKind } from '@/lib/bracketView';
import { liveMatch } from '@/lib/scorecardView';
import { loadCard } from '@/lib/cardData';
import {
  audit,
  drawnBracket,
  finalizeMatchCore,
  findBracket,
  loadMatchEvent,
  matchIn,
  matchRow,
  requireInProgress,
  saveState,
} from '@/lib/bracketCore';
import { matchCardSubject, renderMatchCardEmail } from '@/emails/matchCard';

/**
 * Match-play event after the stroke play-in (round 1): close the play-in (the cut), draw
 * the bracket, schedule each match on its own card, record results (from the signed card,
 * or a forfeit) and set per-round deadlines. Every action returns an ActionResult with a
 * BR code; auth runs first, then all writes go through the service role, and commissioner
 * decisions write audit rows. Bracket state lives in brackets.state (see 0007).
 */

const uuid = z.string().uuid('Invalid id');
const keySchema = z.string().refine(isMatchKey, 'Invalid match');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .nullable();

type Admin = ReturnType<typeof createAdminClient>;

export type ClosePlayInResult = { advanced: string[] } | { needsTiebreak: { spots: number; playerIds: string[] } };

/**
 * Commissioner: close the play-in. Every play-in card with a player still in must be signed.
 * Players still in are ranked (event handicap mode) and the top advanceCount(registered)
 * advance. A tie across the last spot returns `needsTiebreak` until `tiebreakWinners` names
 * exactly that many of the tied players. Creates the brackets row ({ advanced, bracket: null }).
 */
export async function closePlayIn(eventId: string, tiebreakWinners?: string[]): Promise<ActionResult<ClosePlayInResult>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const picks = tiebreakWinners === undefined ? undefined : z.array(uuid).max(64).parse(tiebreakWinners);
    const admin = createAdminClient();
    const ev = await loadMatchEvent(admin, id);
    requireInProgress(ev);
    if (await findBracket(admin, id)) throw new ActionError(BR.alreadyClosed, 'The play-in is already closed');

    const { data: round, error: rErr } = await admin
      .from('rounds')
      .select('id, tee_id')
      .eq('event_id', id)
      .eq('round_number', 1)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!round) throw new ActionError(BR.noGroups, 'The event has no play-in round');
    const { data: groups, error: gErr } = await admin.from('groups').select('id, locked').eq('round_id', round.id);
    if (gErr) throw new Error(gErr.message);
    const groupList = (groups ?? []) as { id: string; locked: boolean }[];
    if (groupList.length === 0) throw new ActionError(BR.noGroups, 'The play-in has no groups');
    const ids = groupList.map((g) => g.id);
    const [{ data: members, error: mErr }, { data: scores, error: sErr }] = await Promise.all([
      admin.from('group_players').select('group_id, player_id, playing_handicap, withdrawn').in('group_id', ids),
      admin.from('scores').select('player_id, hole, gross').in('group_id', ids),
    ]);
    if (mErr) throw new Error(mErr.message);
    if (sErr) throw new Error(sErr.message);
    const memberList = (members ?? []) as { group_id: string; player_id: string; playing_handicap: number | null; withdrawn: boolean | null }[];

    const unsigned = groupList.filter((g) => !g.locked && memberList.some((m) => m.group_id === g.id && !m.withdrawn)).length;
    if (unsigned > 0) {
      throw new ActionError(BR.cardsUnsigned, `All play-in cards must be signed: ${unsigned} card${unsigned === 1 ? '' : 's'} not signed`);
    }

    const { data: regs, error: regErr } = await admin.from('registrations').select('player_id').eq('event_id', id).eq('status', 'registered');
    if (regErr) throw new Error(regErr.message);
    const count = advanceCount((regs ?? []).length);
    const tee = await getTeeInfo(round.tee_id as string, admin);
    const { board } = playInBoard(memberList, (scores ?? []) as { player_id: string; hole: number; gross: number | null }[], tee, ev.handicap_mode === 'net' ? 'net' : 'gross');
    const cut = playInCut(board, count);

    let advanced = cut.advanced;
    if (cut.tiebreak) {
      const tied = new Set(cut.tiebreak.playerIds);
      const chosen = [...new Set(picks ?? [])];
      if (chosen.length !== cut.tiebreak.spots || !chosen.every((p) => tied.has(p))) {
        return { needsTiebreak: cut.tiebreak };
      }
      advanced = [...advanced, ...chosen];
    }
    if (advanced.length < 2) throw new ActionError(BR.notEnoughPlayers, 'At least two players must advance');

    let size = 2;
    while (size < advanced.length) size *= 2;
    const { data: created, error } = await admin
      .from('brackets')
      .insert({ event_id: id, size, rounds: Math.log2(size), version: 0, state: { advanced, bracket: null } })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw new ActionError(BR.alreadyClosed, 'The play-in is already closed');
      throw new Error(error.message);
    }
    await audit(admin, player.id, 'bracket', (created as { id: string }).id, null, {
      action: 'close_play_in',
      advanced,
      count,
      tiebreak: cut.tiebreak ? { ...cut.tiebreak, winners: advanced.slice(cut.advanced.length) } : null,
    });
    return { advanced };
  });
}

/** Commissioner: random draw (Web Crypto) of the advancers; byes come out pre-advanced. Once only. */
export async function drawEventBracket(eventId: string): Promise<ActionResult<Bracket>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const admin = createAdminClient();
    const ev = await loadMatchEvent(admin, id);
    requireInProgress(ev);
    const row = await findBracket(admin, id);
    if (!row) throw new ActionError(BR.playInOpen, 'Close the play-in before the draw');
    if (row.state.bracket) throw new ActionError(BR.alreadyDrawn, 'The bracket has already been drawn');

    const bracket = drawBracket(row.state.advanced, cryptoRng);
    await saveState(admin, row, { ...row.state, bracket }); // version-guarded: a concurrent draw loses
    const { error } = await admin
      .from('bracket_matches')
      .insert(bracket.matches.map((m) => ({ bracket_id: row.id, match_key: m.id, round: m.round })));
    if (error) throw new Error(error.message);
    await audit(admin, player.id, 'bracket', row.id, null, {
      action: 'draw',
      matches: bracket.matches.filter((m) => m.round === 1).map((m) => ({ id: m.id, a: m.a, b: m.b, bye: m.isBye })),
    });
    return bracket;
  });
}

/** Commissioner: deadline for every match of a bracket round, entered as Central wall-clock (YYYY-MM-DDTHH:mm); null clears. */
export async function setRoundDeadline(eventId: string, round: number, deadline: string | null): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const r = z.number().int('Round must be a whole number').min(1, 'Unknown round').parse(round);
    let iso: string | null = null;
    if (deadline !== null) {
      iso = centralInputToIso(z.string().parse(deadline));
      if (!iso) throw new ActionError(BR.invalid, 'Deadline must be a date and time');
    }
    const admin = createAdminClient();
    await loadMatchEvent(admin, id);
    const b = await drawnBracket(admin, id);
    if (r > b.bracket.rounds) throw new ActionError(BR.invalid, 'Unknown round');
    const { data: rows, error } = await admin
      .from('bracket_matches')
      .update({ deadline: iso })
      .eq('bracket_id', b.id)
      .eq('round', r)
      .select('id');
    if (error) throw new Error(error.message);
    await audit(admin, player.id, 'bracket', b.id, null, { action: 'deadline', round: r, deadline: iso, matches: (rows ?? []).length });
    return null;
  });
}

export type MatchCardResult = { code: string; created: boolean; emailed: boolean };

/**
 * One of the match's two players (or a commissioner) starts the match's scorecard: a new
 * round (kind 'match', next round number, the chosen tee and date) with one group of the
 * two players, handicaps snapshotted as on the tee sheet (event allowance and basis, this
 * tee), a group code, and an email with the code to both. The scorer is claimed on the card.
 * Idempotent: a match that has a card returns its code. `teeId` null: the play-in tee.
 */
export async function createMatchCard(
  eventId: string,
  matchKey: string,
  teeId: string | null,
  playDate: string | null,
): Promise<ActionResult<MatchCardResult>> {
  const { player } = await requireUser();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const key = keySchema.parse(matchKey);
    const tee = teeId === null ? null : uuid.parse(teeId);
    const date = dateSchema.parse(playDate);
    const admin = createAdminClient();
    const ev = await loadMatchEvent(admin, id);
    requireInProgress(ev);
    const b = await drawnBracket(admin, id);
    const m = matchIn(b.bracket, key);
    if (player.id !== m.a && player.id !== m.b && !player.is_commissioner) {
      throw new ActionError(BR.notParticipant, 'Only the two players in this match can start its card');
    }
    const bm = await matchRow(admin, b.id, key);
    if (bm.group_id) return { code: await assignCode(admin, bm.group_id), created: false, emailed: false };
    if (m.isBye || !m.a || !m.b) throw new ActionError(BR.notPlayable, 'Both players of this match are not known yet');
    if (m.winner) throw new ActionError(BR.alreadyDecided, 'This match already has a winner');
    const pair = [m.a, m.b];

    const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
    if (!appUrl) throw new Error('APP_URL is not set');

    const teeRow = await teeOf(admin, tee ?? (await playInTee(admin, id)));
    const info = await getTeeInfo(teeRow.id, admin);
    const { data: people, error: pErr } = await admin.from('players').select('id, name, email, handicap_index').in('id', pair);
    if (pErr) throw new Error(pErr.message);
    const byId = new Map(((people ?? []) as { id: string; name: string; email: string; handicap_index: number | string | null }[]).map((p) => [p.id, p]));
    for (const pid of pair) {
      const p = byId.get(pid);
      if (!p) throw new ActionError(BR.notFound, 'A player of this match no longer exists');
      if (p.handicap_index == null && ev.handicap_mode !== 'gross') throw new ActionError(BR.noHandicap, `${p.name} has no handicap index`);
    }

    const roundId = await insertMatchRound(admin, id, teeRow.id, date);
    const { data: group, error: gErr } = await admin.from('groups').insert({ round_id: roundId, start_hole: 1 }).select('id').single();
    if (gErr || !group) throw new Error(gErr?.message ?? 'Could not create the match group');
    const groupId = (group as { id: string }).id;
    const { error: gpErr } = await admin.from('group_players').insert(
      pair.map((pid) => {
        const raw = byId.get(pid)!.handicap_index;
        const index = raw == null ? null : Number(raw);
        return {
          group_id: groupId,
          player_id: pid,
          index_snapshot: index,
          playing_handicap: index == null ? null : playingHandicap(index, info, ev.allowance_pct, ev.handicap_basis),
        };
      }),
    );
    if (gpErr) throw new Error(gpErr.message);
    const code = await assignCode(admin, groupId);

    // Link the card; a card made concurrently wins and ours is dropped.
    const { data: linked, error: linkErr } = await admin
      .from('bracket_matches')
      .update({ group_id: groupId })
      .eq('id', bm.id)
      .is('group_id', null)
      .select('id')
      .maybeSingle();
    if (linkErr) throw new Error(linkErr.message);
    if (!linked) {
      await admin.from('rounds').delete().eq('id', roundId);
      const again = await matchRow(admin, b.id, key);
      if (!again.group_id) throw new ActionError(BR.conflict, 'The match changed while saving; try again');
      return { code: await assignCode(admin, again.group_id), created: false, emailed: false };
    }
    await audit(admin, player.id, 'bracket_match', bm.id, { group_id: null }, { action: 'card_created', match_key: key, round_id: roundId, group_id: groupId, tee_id: teeRow.id, play_date: date });

    const link = `${appUrl}/c/${code}`;
    const label = `Round ${m.round}, match ${m.slot}`;
    const messages: MailMessage[] = pair.map((pid) => {
      const me = byId.get(pid)!;
      const opp = byId.get(pid === m.a ? m.b! : m.a!)!;
      return {
        to: me.email,
        subject: matchCardSubject({ eventName: ev.name, opponentName: opp.name }),
        html: renderMatchCardEmail({
          playerName: me.name,
          opponentName: opp.name,
          eventName: ev.name,
          matchLabel: label,
          playDate: formatRoundDate(date),
          course: teeRow.label,
          code,
          link,
        }),
      };
    });
    let emailed = true;
    try {
      await getMailer().sendBatch(messages);
    } catch {
      emailed = false; // the card exists; the code is shown on the bracket page
    }
    return { code, created: true, emailed };
  });
}

async function playInTee(admin: Admin, eventId: string): Promise<string> {
  const { data, error } = await admin.from('rounds').select('tee_id').eq('event_id', eventId).eq('round_number', 1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(BR.invalid, 'Choose a course and tee');
  return (data as { tee_id: string }).tee_id;
}

async function teeOf(admin: Admin, teeId: string): Promise<{ id: string; label: string }> {
  const { data, error } = await admin.from('tees').select('id, name, course_id').eq('id', teeId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError(BR.notFound, 'That tee does not exist');
  const t = data as { id: string; name: string; course_id: string };
  const { data: course } = await admin.from('courses').select('name').eq('id', t.course_id).maybeSingle();
  return { id: t.id, label: `${(course as { name: string } | null)?.name ?? 'Course'} – ${t.name}` };
}

/** A new rounds row (kind 'match') with the event's next free round number; retries a concurrent taker. */
async function insertMatchRound(admin: Admin, eventId: string, teeId: string, playDate: string | null): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: rounds, error } = await admin.from('rounds').select('round_number').eq('event_id', eventId);
    if (error) throw new Error(error.message);
    const next = Math.max(0, ...((rounds ?? []) as { round_number: number }[]).map((r) => r.round_number)) + 1;
    const { data, error: insErr } = await admin
      .from('rounds')
      .insert({ event_id: eventId, round_number: next, tee_id: teeId, play_date: playDate, kind: 'match' })
      .select('id')
      .single();
    if (!insErr && data) return (data as { id: string }).id;
    if (insErr?.code !== '23505') throw new Error(insErr?.message ?? 'Could not create the match round');
  }
  throw new ActionError(BR.conflict, 'Could not create the match round; try again');
}

/** A player in the match, or a commissioner: record the winner from the signed card (see finalizeMatchCore). */
export async function finalizeMatch(eventId: string, matchKey: string): Promise<ActionResult<{ winnerId: string; result: string }>> {
  const { player } = await requireUser();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const key = keySchema.parse(matchKey);
    const admin = createAdminClient();
    const ev = await loadMatchEvent(admin, id);
    requireInProgress(ev);
    const b = await drawnBracket(admin, id);
    const m = matchIn(b.bracket, key);
    if (player.id !== m.a && player.id !== m.b && !player.is_commissioner) {
      throw new ActionError(BR.notParticipant, 'Only the two players in this match can record its result');
    }
    return finalizeMatchCore(admin, id, key, player.id);
  });
}

/** Commissioner: award a match by forfeit (result "Forfeit"); the winner advances. Audited. */
export async function awardForfeit(eventId: string, matchKey: string, winnerId: string): Promise<ActionResult<null>> {
  const { player } = await requireCommissioner();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const key = keySchema.parse(matchKey);
    const winner = uuid.parse(winnerId);
    const admin = createAdminClient();
    const ev = await loadMatchEvent(admin, id);
    requireInProgress(ev);
    const b = await drawnBracket(admin, id);
    const m = matchIn(b.bracket, key);
    if (m.winner) throw new ActionError(BR.alreadyDecided, 'This match already has a winner');
    if (m.isBye || !m.a || !m.b) throw new ActionError(BR.notPlayable, 'Both players of this match are not known yet');
    if (winner !== m.a && winner !== m.b) throw new ActionError(BR.notInMatch, 'The winner must be one of the match’s players');
    const bm = await matchRow(admin, b.id, key);
    await saveState(admin, b, { ...b.state, bracket: recordWinner(b.bracket, key, winner) });
    const { error } = await admin.from('bracket_matches').update({ result: 'Forfeit', forfeit: true }).eq('id', bm.id);
    if (error) throw new Error(error.message);
    await audit(admin, player.id, 'bracket_match', bm.id, { winner: null, result: bm.result }, { action: 'forfeit', match_key: key, winner, result: 'Forfeit' });
    return null;
  });
}

// ---------------------------------------------------------------------------
// Read model for the bracket pages
// ---------------------------------------------------------------------------
export type PlayerRef = { id: string; name: string };
export type MatchView = {
  key: string;
  round: number;
  slot: number;
  a: PlayerRef | null;
  b: PlayerRef | null;
  winnerId: string | null;
  isBye: boolean;
  kind: MatchKind;
  status: string;
  /** Round deadline (ISO); shown in Central. */
  deadline: string | null;
  /** Deadline passed and no winner yet. */
  pastDeadline: boolean;
  groupId: string | null;
  playDate: string | null;
  cardLocked: boolean;
  /** The viewer plays in this match. */
  mine: boolean;
  /** The card's code: only for the match's players and commissioners. */
  code: string | null;
};
export type BracketView = {
  eventId: string;
  eventName: string;
  eventStatus: string;
  closed: boolean;
  drawn: boolean;
  advanced: PlayerRef[];
  rounds: number;
  matches: MatchView[];
  me: string;
  isCommissioner: boolean;
  /** Names of everyone registered or in the bracket (tiebreak picker). */
  names: Record<string, string>;
  /** Default tee for new match cards: the play-in tee. */
  playInTeeId: string | null;
};

/**
 * Everything the bracket pages show, read with the signed-in user's client (RLS: drafts
 * are not_found). Live labels come from each card's scores via liveMatch. Group codes are
 * not readable by players (column grant), so the codes of the viewer's own matches (all
 * matches for a commissioner) are read with the service role after that check.
 */
export async function getBracketView(eventId: string): Promise<ActionResult<BracketView>> {
  const { player } = await requireUser();
  return toResult(async () => {
    const id = uuid.parse(eventId);
    const supabase = await createServerClient();
    const { data: ev, error: evErr } = await supabase.from('events').select('id, name, format, status').eq('id', id).maybeSingle();
    if (evErr) throw new Error(evErr.message);
    if (!ev || ev.status === 'draft') throw new ActionError(BR.notFound, 'Event not found');
    if (ev.format !== 'match_play') throw new ActionError(BR.notMatchPlay, 'This is not a match-play event');

    const [{ data: bracketRow, error: bErr }, { data: regs, error: regErr }, { data: r1, error: r1Err }] = await Promise.all([
      supabase.from('brackets').select('id, state').eq('event_id', id).maybeSingle(),
      supabase.from('registrations').select('player_id').eq('event_id', id).eq('status', 'registered'),
      supabase.from('rounds').select('tee_id').eq('event_id', id).eq('round_number', 1).maybeSingle(),
    ]);
    if (bErr) throw new Error(bErr.message);
    if (regErr) throw new Error(regErr.message);
    if (r1Err) throw new Error(r1Err.message);
    const state = bracketRow ? parseState(bracketRow.state) : { advanced: [], bracket: null };
    const bracket = state.bracket;

    const { data: rows, error: bmErr } = bracketRow
      ? await supabase.from('bracket_matches').select('match_key, deadline, group_id, result, forfeit').eq('bracket_id', bracketRow.id)
      : { data: [], error: null };
    if (bmErr) throw new Error(bmErr.message);
    const rowOf = new Map(
      ((rows ?? []) as { match_key: string; deadline: string | null; group_id: string | null; result: string | null; forfeit: boolean }[]).map((r) => [r.match_key, r]),
    );

    // Cards: groups, their rounds (date, tee), players' handicaps and scores.
    const groupIds = [...rowOf.values()].map((r) => r.group_id).filter((g): g is string => !!g);
    const cards = await loadCards(supabase, groupIds);

    const ids = new Set<string>([...((regs ?? []) as { player_id: string }[]).map((r) => r.player_id), ...state.advanced]);
    for (const m of bracket?.matches ?? []) for (const p of [m.a, m.b]) if (p) ids.add(p);
    const { data: people, error: pErr } = ids.size
      ? await supabase.from('public_players').select('id, name').in('id', [...ids])
      : { data: [], error: null };
    if (pErr) throw new Error(pErr.message);
    const names: Record<string, string> = {};
    for (const p of (people ?? []) as { id: string; name: string }[]) names[p.id] = p.name;
    const ref = (pid: string | null): PlayerRef | null => (pid ? { id: pid, name: names[pid] ?? 'Player' } : null);

    const isCommissioner = player.is_commissioner === true;
    const visibleCodes = (bracket?.matches ?? [])
      .filter((m) => isCommissioner || m.a === player.id || m.b === player.id)
      .map((m) => rowOf.get(m.id)?.group_id)
      .filter((g): g is string => !!g);
    const codeOf = new Map<string, string>();
    if (visibleCodes.length) {
      const { data: codes, error: cErr } = await createAdminClient().from('groups').select('id, code').in('id', visibleCodes);
      if (cErr) throw new Error(cErr.message);
      for (const c of (codes ?? []) as { id: string; code: string | null }[]) if (c.code) codeOf.set(c.id, c.code);
    }

    const now = Date.now();
    const matches: MatchView[] = (bracket?.matches ?? []).map((m) => {
      const row = rowOf.get(m.id) ?? { deadline: null, group_id: null, result: null, forfeit: false };
      const card = row.group_id ? cards.get(row.group_id) ?? null : null;
      const names2 = (pid: string | null) => (pid ? names[pid] ?? 'Player' : 'Player');
      const live =
        card && card.scored && m.a && m.b
          ? liveMatch(
              {
                players: card.players.map((p) => ({ id: p.id, name: names2(p.id), playingHandicap: p.playingHandicap })),
                holes: card.holes,
                startHole: card.startHole,
                matchStrokes: card.matchStrokes,
              },
              card.scores,
            )
          : null;
      const { kind, status } = describeMatch(m, row, card ? { playDate: card.playDate, scored: card.scored, live } : null);
      return {
        key: m.id,
        round: m.round,
        slot: m.slot,
        a: ref(m.a),
        b: ref(m.b),
        winnerId: m.winner,
        isBye: m.isBye,
        kind,
        status,
        deadline: row.deadline,
        pastDeadline: !!row.deadline && !m.winner && !m.isBye && Date.parse(row.deadline) < now,
        groupId: row.group_id,
        playDate: card?.playDate ?? null,
        cardLocked: card?.locked ?? false,
        mine: m.a === player.id || m.b === player.id,
        code: row.group_id ? codeOf.get(row.group_id) ?? null : null,
      };
    });

    return {
      eventId: id,
      eventName: ev.name as string,
      eventStatus: ev.status as string,
      closed: !!bracketRow,
      drawn: !!bracket,
      advanced: state.advanced.map((p) => ref(p)!),
      rounds: bracket?.rounds ?? 0,
      matches,
      me: player.id,
      isCommissioner,
      names,
      playInTeeId: (r1 as { tee_id: string } | null)?.tee_id ?? null,
    };
  });
}

type CardInfo = {
  playDate: string | null;
  startHole: number;
  locked: boolean;
  matchStrokes: 'full' | 'offLow';
  players: { id: string; playingHandicap: number }[];
  holes: HoleInfo[];
  scores: Record<string, (number | null)[]>;
  scored: boolean;
};

/**
 * Match cards through loadCard with the user client (RLS; granted columns only, never
 * groups.code). Player names come from public_players, not from the card.
 */
async function loadCards(supabase: Awaited<ReturnType<typeof createServerClient>>, groupIds: string[]): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>();
  if (groupIds.length === 0) return out;
  const { data: groups, error } = await supabase.from('groups').select('id, round_id, start_hole, locked').in('id', groupIds);
  if (error) throw new Error(error.message);
  const groupList = (groups ?? []) as { id: string; round_id: string; start_hole: number; locked: boolean }[];
  const { data: rounds, error: rErr } = await supabase.from('rounds').select('id, play_date').in('id', [...new Set(groupList.map((g) => g.round_id))]);
  if (rErr) throw new Error(rErr.message);
  const dateOf = new Map(((rounds ?? []) as { id: string; play_date: string | null }[]).map((r) => [r.id, r.play_date]));
  await Promise.all(
    groupList.map(async (g) => {
      const card = await loadCard(supabase, g);
      out.set(g.id, {
        playDate: dateOf.get(g.round_id) ?? null,
        startHole: g.start_hole,
        locked: g.locked,
        matchStrokes: card.event.matchStrokes,
        players: card.players,
        holes: card.holes,
        scores: card.scores,
        scored: Object.values(card.scores).some((row) => row.some((x) => x != null)),
      });
    }),
  );
  return out;
}
