import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './fakeDb';
import { createFakeMailer } from '@/lib/mailer';

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('./fakeDb').createFakeDb>,
  requireCommissioner: vi.fn(),
  getTeeInfo: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => h.db.from(t) }) }));
vi.mock('@/lib/auth', () => ({ requireCommissioner: h.requireCommissioner }));
vi.mock('@/lib/courses', () => ({ getTeeInfo: h.getTeeInfo }));
vi.mock('@/lib/codes', async (orig) => {
  const actual = await orig<typeof import('@/lib/codes')>();
  return { ...actual, generateGroupCode: vi.fn(actual.generateGroupCode) };
});

import { saveGroups, sendTeeSheet } from '@/actions/teeSheet';
import { generateGroupCode } from '@/lib/codes';
import { ACT } from '@/lib/actionCodes';

const EVENT = '11111111-1111-4111-8111-111111111111';
const ROUND = '22222222-2222-4222-8222-222222222222';
const TEE = '33333333-3333-4333-8333-333333333333';
const P = Array.from({ length: 8 }, (_, i) => `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`);
const NAMES = ['Alex Turner', 'Blake Morgan', 'Casey Reynolds', 'Drew Patterson', 'Evan Brooks', 'Finn Gallagher', 'Grant Holloway', 'Hunter Lane'];
const INDEX = [8.4, 12.1, 4.7, -1.2, 15.3, 10.0, 18.6, 6.2];
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const tee = { rating: 71.8, slope: 140, par: 72, holes };

function seed(event: Record<string, unknown> = {}) {
  h.db = createFakeDb(
    {
      events: [{ id: EVENT, name: 'Spring Opener', status: 'registration_closed', allowance_pct: 100, handicap_basis: 'index', handicap_mode: 'net', ...event }],
      rounds: [{ id: ROUND, event_id: EVENT, round_number: 1, tee_id: TEE, play_date: '2027-04-10' }],
      players: P.map((id, i) => ({ id, name: NAMES[i], email: `player${i + 1}@example.test`, handicap_index: INDEX[i] })),
      registrations: P.map((id, i) => ({ id: `reg-${i}`, event_id: EVENT, player_id: id, status: i === 7 ? 'withdrawn' : 'registered' })),
      // (P[7] withdrawn)
      groups: [],
      group_players: [],
      scores: [],
      signatures: [],
      audit_log: [],
    },
    { groups: ['code'] },
    { groups: [['group_players', 'group_id'], ['scores', 'group_id'], ['signatures', 'group_id']] },
  );
}

const twoGroups = () => [
  { teeTime: '08:10', startHole: 1, playerIds: [P[0]!, P[1]!, P[2]!, P[3]!], scorerPlayerId: P[0]! },
  { teeTime: '08:20', startHole: 10, playerIds: [P[4]!, P[5]!, P[6]!], scorerPlayerId: null },
];
const groupsOf = () => h.db.tables.groups!;
const gpsOf = () => h.db.tables.group_players!;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_URL = 'https://tour.example.test/';
  h.requireCommissioner.mockResolvedValue({ userId: 'u', player: { id: P[0] } });
  h.getTeeInfo.mockResolvedValue(tee);
  seed();
});

describe('saveGroups', () => {
  it('requires a commissioner before any DB call', async () => {
    h.requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    const spy = vi.spyOn(h.db, 'from');
    await expect(saveGroups(ROUND, twoGroups())).rejects.toThrow(/forbidden/);
    expect(spy).not.toHaveBeenCalled();
  });
  it('creates groups and group_players (no codes or snapshots yet) and audits', async () => {
    await saveGroups(ROUND, twoGroups());
    expect(groupsOf()).toHaveLength(2);
    const g1 = groupsOf().find((g) => g.start_hole === 1)!;
    expect(g1).toMatchObject({ round_id: ROUND, tee_time: '08:10', scorer_player_id: P[0] });
    expect(g1.code ?? null).toBeNull();
    expect(gpsOf().filter((r) => r.group_id === g1.id).map((r) => r.player_id)).toEqual(P.slice(0, 4));
    expect(gpsOf().every((r) => r.index_snapshot == null && r.playing_handicap == null)).toBe(true);
    expect(h.db.tables.audit_log).toHaveLength(1);
    expect(h.db.tables.audit_log![0]).toMatchObject({ actor_player_id: P[0], entity: 'round', entity_id: ROUND });
  });
  it('rejects a player who is not registered for the event', async () => {
    const groups = twoGroups();
    groups[1]!.playerIds.push(P[7]!); // withdrawn
    await expect(saveGroups(ROUND, groups)).resolves.toMatchObject({ ok: false, code: ACT.notRegistered });
    expect(h.db.writes).toEqual([]);
  });
  it('rejects a player in two groups', async () => {
    const groups = twoGroups();
    groups[1]!.playerIds.push(P[0]!);
    await expect(saveGroups(ROUND, groups)).resolves.toMatchObject({ ok: false, code: ACT.duplicatePlayer });
  });
  it('a commissioner-chosen new scorer frees the phone and marks the scorer as assigned, not self-claimed', async () => {
    await saveGroups(ROUND, twoGroups());
    const g2 = groupsOf().find((g) => g.start_hole === 10)!;
    Object.assign(g2, { scorer_player_id: P[4], scorer_device_token: 'tok', scorer_self_claimed: true }); // a phone claimed it
    const groups = twoGroups();
    await saveGroups(ROUND, [groups[0]!, { ...groups[1]!, id: g2.id as string, scorerPlayerId: P[4]! }]);
    expect(g2).toMatchObject({ scorer_device_token: 'tok', scorer_self_claimed: true }); // same scorer: untouched
    await saveGroups(ROUND, [groups[0]!, { ...groups[1]!, id: g2.id as string, scorerPlayerId: P[5]! }]);
    expect(groupsOf().find((g) => g.id === g2.id)).toMatchObject({
      scorer_player_id: P[5],
      scorer_device_token: null,
      scorer_self_claimed: false,
    });
  });
  it('rejects a scorer who is not in the group', async () => {
    const groups = twoGroups();
    groups[1]!.scorerPlayerId = P[0]!;
    await expect(saveGroups(ROUND, groups)).resolves.toMatchObject({ ok: false, code: ACT.scorerNotInGroup });
  });
  it('rejects a bad tee time or start hole before any DB call', async () => {
    const spy = vi.spyOn(h.db, 'from');
    await expect(saveGroups(ROUND, [{ ...twoGroups()[0]!, teeTime: '8am' }])).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    await expect(saveGroups(ROUND, [{ ...twoGroups()[0]!, startHole: 19 }])).resolves.toMatchObject({ ok: false, code: ACT.invalid });
    expect(spy).not.toHaveBeenCalled();
  });
  it('refuses when a group of the round is locked or signed', async () => {
    await saveGroups(ROUND, twoGroups());
    groupsOf()[0]!.locked = true;
    await expect(saveGroups(ROUND, twoGroups())).resolves.toMatchObject({ ok: false, code: ACT.groupsLocked });
    groupsOf()[0]!.locked = false;
    groupsOf()[0]!.signed_at = '2027-04-10T18:00:00Z';
    await expect(saveGroups(ROUND, twoGroups())).resolves.toMatchObject({ ok: false, code: ACT.groupsLocked });
  });
  it('refuses to change a group that has scores (would cascade-delete the scorecard)', async () => {
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    const g2 = groupsOf().find((g) => g.start_hole === 10)!;
    h.db.tables.scores!.push({ id: 's1', group_id: g2.id, player_id: P[4], hole: 10, gross: 4 });
    const groups = twoGroups();
    groups[1]!.playerIds.pop(); // move P[6] out of the scored group
    const before = h.db.writes.length;
    await expect(saveGroups(ROUND, groups)).resolves.toMatchObject({ ok: false, code: ACT.scoresEntered });
    expect(h.db.writes.length).toBe(before);
    expect(groupsOf().find((g) => g.id === g2.id)).toBeDefined();
  });
  it('allows tee-time edits on a group with scores when its players are unchanged', async () => {
    await saveGroups(ROUND, twoGroups());
    const g2 = groupsOf().find((g) => g.start_hole === 10)!;
    h.db.tables.scores!.push({ id: 's1', group_id: g2.id, player_id: P[4], hole: 10, gross: 4 });
    const groups = twoGroups();
    groups[1]!.teeTime = '09:00';
    await saveGroups(ROUND, groups);
    expect(groupsOf().find((g) => g.id === g2.id)).toMatchObject({ tee_time: '09:00' });
  });
  it('carries existing snapshots into re-created groups (index change + membership change + resend)', async () => {
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    const snap = (i: number) => {
      const r = gpsOf().find((x) => x.player_id === P[i])!;
      return { index_snapshot: r.index_snapshot, playing_handicap: r.playing_handicap };
    };
    const before = [0, 1, 2, 3, 4, 5, 6].map(snap);
    for (const p of h.db.tables.players!) p.handicap_index = 30.0;
    // Move P[3] from group 1 to group 2: both groups are re-created.
    await saveGroups(ROUND, [
      { teeTime: '08:10', startHole: 1, playerIds: [P[0]!, P[1]!, P[2]!], scorerPlayerId: P[0]! },
      { teeTime: '08:20', startHole: 10, playerIds: [P[3]!, P[4]!, P[5]!, P[6]!], scorerPlayerId: null },
    ]);
    await sendTeeSheet(ROUND, createFakeMailer());
    expect([0, 1, 2, 3, 4, 5, 6].map(snap)).toEqual(before);
    expect(snap(0)).toEqual({ index_snapshot: 8.4, playing_handicap: 8 });
  });
  it('keeps an unchanged group row (code, snapshots) and replaces a changed one', async () => {
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    const before = groupsOf().map((g) => ({ ...g }));
    const g1 = before.find((g) => g.start_hole === 1)!;
    const g2 = before.find((g) => g.start_hole === 10)!;
    const g1Snaps = gpsOf().filter((r) => r.group_id === g1.id).map((r) => ({ ...r }));

    await saveGroups(ROUND, [
      { id: g1.id as string, teeTime: '08:30', startHole: 1, playerIds: [P[3]!, P[2]!, P[1]!, P[0]!], scorerPlayerId: P[0]! },
      { id: g2.id as string, teeTime: '08:40', startHole: 10, playerIds: [P[4]!, P[5]!], scorerPlayerId: null },
      { teeTime: '08:50', startHole: 1, playerIds: [P[6]!], scorerPlayerId: P[6]! },
    ]);
    const kept = groupsOf().find((g) => g.id === g1.id)!;
    expect(kept).toMatchObject({ code: g1.code, tee_time: '08:30' });
    expect(gpsOf().filter((r) => r.group_id === g1.id)).toEqual(g1Snaps);
    expect(groupsOf().find((g) => g.id === g2.id)).toBeUndefined();
    expect(groupsOf()).toHaveLength(3);
    const fresh = groupsOf().filter((g) => g.id !== g1.id);
    expect(fresh.every((g) => g.code == null)).toBe(true);
  });
});

describe('sendTeeSheet', () => {
  it('requires a commissioner before any DB call', async () => {
    h.requireCommissioner.mockRejectedValue(new Error('NEXT_REDIRECT:/forbidden'));
    const spy = vi.spyOn(h.db, 'from');
    await expect(sendTeeSheet(ROUND, createFakeMailer())).rejects.toThrow(/forbidden/);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(['draft', 'published', 'final'])('refuses a %s event (close registration first)', async (status) => {
    seed({ status: 'registration_closed' });
    await saveGroups(ROUND, twoGroups());
    h.db.tables.events![0]!.status = status;
    const before = h.db.writes.length;
    await expect(sendTeeSheet(ROUND, createFakeMailer())).resolves.toMatchObject({ ok: false, code: ACT.wrongStatus });
    expect(h.db.writes.length).toBe(before);
  });
  it('refuses (before writing or mailing) when grouped players have withdrawn', async () => {
    await saveGroups(ROUND, twoGroups());
    h.db.tables.registrations!.find((r) => r.player_id === P[1])!.status = 'withdrawn';
    h.db.tables.registrations!.find((r) => r.player_id === P[5])!.status = 'withdrawn';
    const before = h.db.writes.length;
    const mailer = createFakeMailer();
    await expect(sendTeeSheet(ROUND, mailer)).resolves.toMatchObject({ ok: false, code: ACT.notRegistered });
    expect(h.db.writes.length).toBe(before);
    expect(mailer.sent).toEqual([]);
  });
  it('sends all emails in one sendBatch call', async () => {
    await saveGroups(ROUND, twoGroups());
    const mailer = createFakeMailer();
    const batch = vi.spyOn(mailer, 'sendBatch');
    const single = vi.spyOn(mailer, 'send');
    await sendTeeSheet(ROUND, mailer);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0]).toHaveLength(7);
    expect(single).not.toHaveBeenCalled();
  });
  it('refuses a round with no groups', async () => {
    await expect(sendTeeSheet(ROUND, createFakeMailer())).resolves.toMatchObject({ ok: false, code: ACT.noGroups });
  });
  it('sends one email per player, each containing that player\'s group code and link', async () => {
    await saveGroups(ROUND, twoGroups());
    const mailer = createFakeMailer();
    const res = await sendTeeSheet(ROUND, mailer);
    expect(res).toEqual({ ok: true, data: { sent: 7 } });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(P.slice(0, 7).map((_, i) => `player${i + 1}@example.test`).sort());
    for (const m of mailer.sent) {
      const i = Number(m.to.match(/player(\d+)@/)![1]) - 1;
      const gp = gpsOf().find((r) => r.player_id === P[i])!;
      const code = groupsOf().find((g) => g.id === gp.group_id)!.code as string;
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(m.html).toContain(code);
      expect(m.html).toContain(`https://tour.example.test/c/${code}`);
      expect(m.html).toContain('Spring Opener');
      expect(m.html).toContain('Saturday, April 10, 2027');
      expect(m.subject).toContain('Spring Opener');
    }
    const first = mailer.sent.find((m) => m.to === 'player1@example.test')!;
    expect(first.html).toContain('8:10 AM CDT');
    expect(first.html).toContain('Hole 1');
    for (const mate of ['Blake Morgan', 'Casey Reynolds', 'Drew Patterson']) expect(first.html).toContain(mate);
    expect(first.html).not.toContain('Evan Brooks');
    const fifth = mailer.sent.find((m) => m.to === 'player5@example.test')!;
    expect(fifth.html).toContain('8:20 AM CDT');
    expect(fifth.html).toContain('Hole 10');
    const codes = groupsOf().map((g) => g.code);
    expect(new Set(codes).size).toBe(2);
  });
  it('escapes HTML in names', async () => {
    h.db.tables.players![1]!.name = '<b>Blake</b>';
    await saveGroups(ROUND, twoGroups());
    const mailer = createFakeMailer();
    await sendTeeSheet(ROUND, mailer);
    const first = mailer.sent.find((m) => m.to === 'player1@example.test')!;
    expect(first.html).not.toContain('<b>Blake</b>');
    expect(first.html).toContain('&lt;b&gt;Blake&lt;/b&gt;');
  });
  it('snapshots index and playing handicap (index basis, 100%)', async () => {
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    const byPlayer = (i: number) => gpsOf().find((r) => r.player_id === P[i])!;
    expect(byPlayer(0)).toMatchObject({ index_snapshot: 8.4, playing_handicap: 8 });
    expect(byPlayer(3)).toMatchObject({ index_snapshot: -1.2, playing_handicap: -1 });
    expect(byPlayer(4)).toMatchObject({ index_snapshot: 15.3, playing_handicap: 15 });
  });
  it('uses the event allowance and course basis with the round tee', async () => {
    seed({ allowance_pct: 90, handicap_basis: 'course' });
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    expect(h.getTeeInfo).toHaveBeenCalledWith(TEE);
    // 15.3 * 140/113 + (71.8 - 72) = 18.756; * 0.9 = 16.88 -> 17
    expect(gpsOf().find((r) => r.player_id === P[4])).toMatchObject({ index_snapshot: 15.3, playing_handicap: 17 });
  });
  it('still stores playing_handicap for a gross event', async () => {
    seed({ handicap_mode: 'gross' });
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    expect(gpsOf().find((r) => r.player_id === P[1])).toMatchObject({ index_snapshot: 12.1, playing_handicap: 12 });
  });
  it('refuses (before writing) when a net player has no handicap index', async () => {
    h.db.tables.players![2]!.handicap_index = null;
    await saveGroups(ROUND, twoGroups());
    const before = h.db.writes.length;
    await expect(sendTeeSheet(ROUND, createFakeMailer())).resolves.toMatchObject({ ok: false, code: ACT.noHandicap });
    expect(h.db.writes.length).toBe(before);
  });
  it('moves registration_closed -> in_progress with an audit row', async () => {
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    expect(h.db.tables.events![0]!.status).toBe('in_progress');
    expect(h.db.tables.audit_log).toContainEqual(
      expect.objectContaining({ entity: 'event', entity_id: EVENT, before: { status: 'registration_closed' }, after: { status: 'in_progress' } }),
    );
  });
  it('leaves other statuses alone', async () => {
    seed({ status: 'in_progress' });
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    expect(h.db.tables.events![0]!.status).toBe('in_progress');
    expect(h.db.tables.audit_log!.filter((a) => a.entity === 'event')).toEqual([]);
  });
  it('resend does not change codes or snapshots, even after an index change', async () => {
    await saveGroups(ROUND, twoGroups());
    await sendTeeSheet(ROUND, createFakeMailer());
    const codes = groupsOf().map((g) => [g.id, g.code]);
    const snaps = gpsOf().map((r) => ({ ...r }));
    h.db.tables.players![0]!.handicap_index = 20.0;
    const mailer = createFakeMailer();
    await expect(sendTeeSheet(ROUND, mailer)).resolves.toEqual({ ok: true, data: { sent: 7 } });
    expect(groupsOf().map((g) => [g.id, g.code])).toEqual(codes);
    expect(gpsOf()).toEqual(snaps);
    const first = mailer.sent.find((m) => m.to === 'player1@example.test')!;
    expect(first.html).toContain(codes.find(([id]) => gpsOf().find((r) => r.player_id === P[0])!.group_id === id)![1] as string);
  });
  it('retries the code on a unique violation', async () => {
    h.db.tables.groups!.push({ id: 'other', round_id: 'other-round', code: 'TAKEN2', locked: false, signed_at: null });
    await saveGroups(ROUND, [twoGroups()[0]!]);
    vi.mocked(generateGroupCode).mockReturnValueOnce('TAKEN2').mockReturnValueOnce('TAKEN2').mockReturnValueOnce('FRESH3');
    await sendTeeSheet(ROUND, createFakeMailer());
    expect(groupsOf().find((g) => g.round_id === ROUND)!.code).toBe('FRESH3');
  });
  it('gives up after 5 unique violations', async () => {
    h.db.tables.groups!.push({ id: 'other', round_id: 'other-round', code: 'TAKEN2', locked: false, signed_at: null });
    await saveGroups(ROUND, [twoGroups()[0]!]);
    vi.mocked(generateGroupCode).mockReturnValue('TAKEN2');
    await expect(sendTeeSheet(ROUND, createFakeMailer())).resolves.toMatchObject({ ok: false, code: ACT.codeUnavailable });
    vi.mocked(generateGroupCode).mockReset();
  });
});
