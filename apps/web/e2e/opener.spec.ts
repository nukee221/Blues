import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { adminClient } from './support/env';
import { anonymousPhone, phoneAs } from './support/auth';
import { ADVANCERS, FIELD, grossFor, type World } from './support/world';

const admin = adminClient();
const COMMISSIONER = 'player01@example.test';
const SHOTS = path.resolve(process.cwd(), '../../docs/screenshots');
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;

const w: World = {
  eventId: '',
  eventName: `Opener E2E ${Date.now()}`,
  roundId: '',
  teeId: '',
  pars: [],
  players: new Map(),
  pins: new Map(),
  groups: [],
  contexts: new Map(),
};

/** A signed-in phone context for a player, made once and reused. */
async function ctxFor(browser: Browser, email: string): Promise<BrowserContext> {
  let c = w.contexts.get(email);
  if (!c) {
    c = await phoneAs(browser, baseURL, email);
    w.contexts.set(email, c);
  }
  return c;
}
async function pageFor(browser: Browser, email: string, url: string): Promise<Page> {
  const page = await (await ctxFor(browser, email)).newPage();
  await page.goto(url);
  return page;
}

async function must<T>(r: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await r;
  if (error) throw new Error(error.message);
  return data as T;
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  for (const c of w.contexts.values()) await c.close().catch(() => {});
});

test('stage 1: draft event, publish, registration, groups and tee sheet', async ({ browser }) => {
  const players = await must(admin.from('players').select('id, name, email').order('email'));
  for (const p of players as { id: string; name: string; email: string }[]) w.players.set(p.email, p);
  expect(w.players.size).toBe(12);

  // --- Commissioner creates a match-play event (draft) for 2027 at Cherokee Ridge, blue tees, net, 100%.
  const boss = await (await ctxFor(browser, COMMISSIONER)).newPage();
  await boss.goto('/admin/events/new');
  await boss.getByLabel('Event name').fill(w.eventName);
  await boss.getByLabel('Season').selectOption({ label: '2027' });
  await boss.getByLabel('Event type').selectOption('match_play');
  await boss.getByLabel('Format').selectOption('match_play');
  await boss.getByLabel('Handicap mode').selectOption('net');
  await expect(boss.getByLabel('Allowance %')).toHaveValue('100');
  await boss.getByLabel('Registration deadline (Central time)').fill('2027-02-13T20:00');
  await boss.locator('section', { hasText: 'Round 1' }).locator('select').first().selectOption({ label: 'Cherokee Ridge Country Club – Blue' });
  await boss.getByLabel('Play date').fill('2027-02-14');
  await boss.getByRole('button', { name: 'Save event' }).click();
  await boss.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/);
  w.eventId = boss.url().split('/').pop()!;
  await expect(boss.getByText('draft', { exact: true })).toBeVisible();

  const ev = await must(admin.from('events').select('format, handicap_mode, allowance_pct, status, season_id').eq('id', w.eventId).single());
  expect(ev).toMatchObject({ format: 'match_play', handicap_mode: 'net', allowance_pct: 100, status: 'draft' });
  const round = await must(admin.from('rounds').select('id, tee_id, kind').eq('event_id', w.eventId).eq('round_number', 1).single());
  w.roundId = (round as { id: string }).id;
  w.teeId = (round as { tee_id: string }).tee_id;
  expect((round as { kind: string }).kind).toBe('stroke');
  const holes = await must(admin.from('holes').select('number, par').eq('tee_id', w.teeId).order('number'));
  w.pars = (holes as { par: number }[]).map((h) => h.par);
  expect(w.pars).toHaveLength(18);

  // --- A player cannot see the draft.
  const drew = await pageFor(browser, 'player04@example.test', '/events');
  await expect(drew.getByRole('heading', { name: 'Events' })).toBeVisible();
  await expect(drew.getByText(w.eventName)).toHaveCount(0);
  const direct = await drew.goto(`/events/${w.eventId}`);
  expect(direct?.status()).toBe(404);

  // --- Commissioner publishes.
  await boss.goto(`/admin/events/${w.eventId}`);
  await boss.getByRole('button', { name: 'Publish' }).click();
  await expect(boss.getByText('published', { exact: true })).toBeVisible();

  // --- Registration: two players through the UI, the rest by service-role insert.
  const uiRegistrants = ['player04@example.test', 'player05@example.test'];
  for (const email of uiRegistrants) {
    const page = await pageFor(browser, email, `/events/${w.eventId}`);
    await expect(page.getByRole('heading', { name: w.eventName })).toBeVisible();
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    await page.close();
  }
  const rest = [...w.players.values()].filter((p) => !uiRegistrants.includes(p.email));
  await must(admin.from('registrations').insert(rest.map((p) => ({ event_id: w.eventId, player_id: p.id, status: 'registered' }))).select('id'));
  const regCount = await must(admin.from('registrations').select('id').eq('event_id', w.eventId).eq('status', 'registered'));
  expect(regCount).toHaveLength(12);

  // --- The player sees 12 registered and the cut-line text.
  await drew.goto(`/events/${w.eventId}`);
  await expect(drew.getByRole('heading', { name: 'Registered (12)' })).toBeVisible();
  await expect(drew.getByText('Top 6 advance')).toBeVisible();

  // --- Close registration, auto-group into 3 groups, pick scorers, send the tee sheet.
  await boss.goto(`/admin/events/${w.eventId}`);
  await boss.getByRole('button', { name: 'Close registration' }).click();
  await expect(boss.getByText('registration closed', { exact: true })).toBeVisible();
  await boss.getByRole('link', { name: 'Round 1 groups' }).click();
  await boss.getByRole('button', { name: 'Auto-group' }).click();
  await expect(boss.getByRole('heading', { name: /^Group \d$/ })).toHaveCount(3);
  await boss.locator('input[type="time"]').first().fill('08:00');
  const scorerSelects = boss.getByLabel('Scorer');
  await expect(scorerSelects).toHaveCount(3);
  for (let i = 0; i < 3; i++) await scorerSelects.nth(i).selectOption({ index: 1 });
  await boss.getByRole('button', { name: 'Save groups' }).click();
  await expect(boss.getByRole('status')).toHaveText('Groups saved');
  await boss.getByRole('button', { name: 'Send tee sheet' }).click();
  await expect(boss.getByRole('status')).toHaveText('Tee sheet sent to 12 players');
  await expect(boss.getByLabel('Group code')).toHaveCount(3);

  const status = await must(admin.from('events').select('status').eq('id', w.eventId).single());
  expect((status as { status: string }).status).toBe('in_progress');
  const groups = await must(admin.from('groups').select('id, code, scorer_player_id, tee_time').eq('round_id', w.roundId).order('tee_time').order('created_at'));
  for (const g of groups as { id: string; code: string; scorer_player_id: string }[]) {
    expect(g.code).toMatch(/^[A-Z2-9]{6}$/);
    const members = await must(
      admin.from('group_players').select('player_id, playing_handicap, players(name, email)').eq('group_id', g.id).order('created_at'),
    );
    const list = (members as unknown as { player_id: string; playing_handicap: number; players: { name: string; email: string } }[]).map((m) => ({
      id: m.player_id,
      email: m.players.email,
      name: m.players.name,
      ph: m.playing_handicap,
    }));
    expect(list).toHaveLength(4);
    expect(list.every((m) => Number.isInteger(m.ph))).toBe(true);
    w.groups.push({ id: g.id, code: g.code, scorerId: g.scorer_player_id, members: list });
  }
  expect(w.groups).toHaveLength(3);
});

// ---------------------------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------------------------
const nameOf = (email: string) => w.players.get(email)!.name;
const netTarget = new Map(FIELD.map((f) => [f.email, f.net]));
const grossOf = (email: string, ph: number) => grossFor(w.pars, netTarget.get(email)!, ph, FIELD.findIndex((f) => f.email === email) * 5);

async function seedPin(email: string, pin: string) {
  await must(admin.from('players').update({ pin_hash: await bcrypt.hash(pin, 6) }).eq('email', email).select('id'));
  w.pins.set(email, pin);
}

/** Taps one hole for every player: the first "+" gives par, then up or down to `gross`. */
async function tapHole(page: Page, hole: number, entries: { name: string; gross: number; par: number }[]) {
  await expect(page.getByRole('heading', { name: `Hole ${hole}`, exact: true })).toBeVisible();
  for (const e of entries) {
    const plus = page.getByRole('button', { name: `${e.name} plus one` });
    const minus = page.getByRole('button', { name: `${e.name} minus one` });
    await plus.click();
    for (let k = e.par; k < e.gross; k++) await plus.click();
    for (let k = e.par; k > e.gross; k--) await minus.click();
    await expect(page.getByLabel(`${e.name} gross`)).toHaveText(String(e.gross));
  }
}

async function signUi(page: Page, who: string, role: 'scorer' | 'attest', pin: string) {
  await page.getByRole('button', { name: `${who} (${role})` }).click();
  await page.getByLabel(`PIN for ${who}`).fill(pin);
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
}

async function insertScores(groupId: string, rows: { playerId: string; gross: number[] }[]) {
  const stamp = new Date().toISOString();
  await must(
    admin
      .from('scores')
      .insert(rows.flatMap((r) => r.gross.map((gross, i) => ({ group_id: groupId, player_id: r.playerId, hole: i + 1, gross, client_ts: stamp }))))
      .select('id'),
  );
}

async function serviceSign(groupId: string, scorerId: string, attesterId: string) {
  const a = await admin.rpc('sign_card', { p_group: groupId, p_player: scorerId, p_role: 'scorer' });
  if (a.error) throw new Error(a.error.message);
  const b = await admin.rpc('sign_card', { p_group: groupId, p_player: attesterId, p_role: 'attest' });
  if (b.error) throw new Error(b.error.message);
  expect(b.data).toBe(true);
}

test('stage 2: scoring, PINs and signing for all three groups, then the leaderboard', async ({ browser }) => {
  const [uiGroup, ...serviceGroups] = w.groups;
  const scorer = uiGroup!.members.find((m) => m.id === uiGroup!.scorerId)!;
  const attester = uiGroup!.members.find((m) => m.id !== uiGroup!.scorerId)!;

  // --- PINs: the UI group's two signers set theirs on /me/pin; everyone else is seeded (bcrypt via service role).
  const uiPins = new Map([[scorer.email, '2468'], [attester.email, '1357']]);
  for (const [email, pin] of uiPins) {
    const page = await pageFor(browser, email, '/me/pin');
    await page.getByLabel('PIN', { exact: true }).fill(pin);
    await page.getByLabel('Repeat PIN').fill(pin);
    await page.getByRole('button', { name: 'Save PIN' }).click();
    await expect(page.getByText('PIN saved.')).toBeVisible();
    await page.close();
    w.pins.set(email, pin);
    const row = await must(admin.from('players').select('pin_hash').eq('email', email).single());
    expect((row as { pin_hash: string }).pin_hash).toMatch(/^\$2[aby]\$/);
  }
  for (const p of w.players.values()) if (!uiPins.has(p.email)) await seedPin(p.email, '4321');

  // --- Group 1, fully through the UI: open the code on a phone with no login, claim scorer, tap 18 holes x 4 players, sign twice.
  const phoneCtx = await anonymousPhone(browser, baseURL);
  const card = await phoneCtx.newPage();
  await card.goto(`/c/${uiGroup!.code}`);
  await card.getByRole('button', { name: `I'm ${scorer.name}: keep score on this phone` }).click();
  await expect(card.getByRole('button', { name: `${scorer.name} plus one` })).toBeVisible();
  for (let hole = 1; hole <= 18; hole++) {
    await tapHole(
      card,
      hole,
      uiGroup!.members.map((m) => ({ name: m.name, gross: grossOf(m.email, m.ph)[hole - 1]!, par: w.pars[hole - 1]! })),
    );
    if (hole === 9) await card.screenshot({ path: path.join(SHOTS, 'scorecard-hole-entry.png') });
    if (hole < 18) await card.getByRole('button', { name: 'Next →' }).click();
  }
  await expect(card.getByRole('region', { name: 'Sign card' })).toBeVisible({ timeout: 45_000 });
  await signUi(card, scorer.name, 'scorer', w.pins.get(scorer.email)!);
  await expect(card.getByText(`Scorer: ${scorer.name} ✓ signed`)).toBeVisible();
  await signUi(card, attester.name, 'attest', w.pins.get(attester.email)!);
  await expect(card.getByRole('region', { name: 'Card signed' })).toBeVisible();
  await expect(card.getByText(`Attested: ${attester.name}`)).toBeVisible();
  const g0 = await must(admin.from('groups').select('locked, signed_at').eq('id', uiGroup!.id).single());
  expect((g0 as { locked: boolean }).locked).toBe(true);
  // What the server stored is what was tapped.
  const stored = await must(admin.from('scores').select('player_id, hole, gross').eq('group_id', uiGroup!.id));
  expect(stored).toHaveLength(72);
  for (const m of uiGroup!.members) {
    const want = grossOf(m.email, m.ph);
    for (const s of (stored as { player_id: string; hole: number; gross: number }[]).filter((x) => x.player_id === m.id)) {
      expect(s.gross).toBe(want[s.hole - 1]);
    }
  }
  await phoneCtx.close();

  // --- Groups 2 and 3: open the code in the browser, scores and signatures through the service path.
  for (const [i, g] of serviceGroups.entries()) {
    await insertScores(g.id, g.members.map((m) => ({ playerId: m.id, gross: grossOf(m.email, m.ph) })));
    const att = g.members.find((m) => m.id !== g.scorerId)!;
    const viewer = await anonymousPhone(browser, baseURL);
    const page = await viewer.newPage();
    await page.goto(`/c/${g.code}`);
    await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sign card' })).toBeVisible(); // complete card: ready to sign
    await serviceSign(g.id, g.scorerId, att.id);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Card signed' })).toBeVisible();
    await viewer.close();

    if (i === 0) {
      // One card still unsigned: the commissioner sees it and cannot close the play-in yet.
      const boss = await (await ctxFor(browser, COMMISSIONER)).newPage();
      await boss.goto(`/admin/events/${w.eventId}`);
      await expect(boss.getByRole('heading', { name: 'Unsigned cards' })).toBeVisible();
      await expect(boss.getByText('not signed', { exact: true })).toHaveCount(1);
      await boss.goto(`/admin/events/${w.eventId}/bracket`);
      await boss.getByRole('button', { name: 'Close play-in' }).click();
      await expect(boss.getByText('All play-in cards must be signed: 1 card not signed')).toBeVisible();
      await boss.close();
    }
  }
  const signed = await must(admin.from('groups').select('id').eq('round_id', w.roundId).eq('locked', true));
  expect(signed).toHaveLength(3);

  // --- Leaderboard: 12 players, best net first, the "Top 6 advance" line under 6th.
  const player = await (await ctxFor(browser, 'player04@example.test')).newPage();
  await player.goto(`/events/${w.eventId}/leaderboard`);
  const rows = player.locator('tbody tr:not([data-testid="cut-line"])');
  await expect(rows).toHaveCount(12);
  for (const [i, f] of FIELD.entries()) await expect(rows.nth(i).locator('td').nth(1)).toContainText(nameOf(f.email));
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText('−4'); // net 68 on a par-72 course
  await expect(player.getByTestId('cut-line')).toHaveText('Top 6 advance');
  await expect(player.getByText('Advancing')).toHaveCount(6);
  // The cut line sits between 6th and 7th.
  const order = await player.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.testid ?? 'row'));
  expect(order.indexOf('cut-line')).toBe(6);
  await player.screenshot({ path: path.join(SHOTS, 'leaderboard-cut-line.png'), fullPage: true });
});
