import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { adminClient } from './support/env';
import { anonymousPhone, browserErrors, phoneAs } from './support/auth';
import { ADVANCERS, FIELD, grossFor, type World } from './support/world';

const admin = adminClient();
const COMMISSIONER = 'player01@example.test';
const SHOTS = path.resolve(process.cwd(), '../../docs/screenshots');
const FLOW_TABBAR = 'nav[aria-label="Primary"] { position: static !important; }'; // keep the fixed tab bar out of the middle of full-page shots
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3000}`;

const w: World = {
  eventId: '',
  eventName: 'Season Opener Match Play',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(r: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await r;
  if (error) throw new Error(error.message);
  return data;
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  for (const c of w.contexts.values()) await c.close().catch(() => {});
});

// --- The real sign-in path: /login form -> emailed link (read from the local Mailpit) -> /auth/callback -> player link.
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

/** Link in the newest message to `to` that arrived after `since` (the Supabase magic-link email). */
async function magicLinkFor(to: string, since: number): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as {
          messages: { ID: string; Created: string }[];
        };
        const fresh = list.messages.filter((m) => new Date(m.Created).getTime() >= since).sort((a, b) => b.Created.localeCompare(a.Created))[0];
        if (!fresh) return '';
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string; Text: string };
        const m = (msg.HTML + msg.Text).match(/https?:\/\/[^"'\s<>]*\/auth\/v1\/verify[^"'\s<>]*/);
        link = (m?.[0] ?? '').replace(/&amp;/g, '&');
        return link;
      },
      { timeout: 30_000, message: `no sign-in email for ${to} in Mailpit` },
    )
    .not.toBe('');
  return link;
}

const LINK_SENT = 'If that email is on the roster, a link is on its way.';

async function requestLink(browser: Browser, email: string) {
  const context = await anonymousPhone(browser, baseURL);
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toHaveText(LINK_SENT);
  return { context, page };
}

async function signInThroughForm(browser: Browser, email: string) {
  const since = Date.now() - 2000;
  const { context, page } = await requestLink(browser, email);
  const link = await magicLinkFor(email, since);
  await page.goto(link); // same browser context: it holds the PKCE code verifier cookie
  return { context, page };
}

async function authUserExists(email: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.some((u) => u.email === email);
}

test('login: a rostered player signs in through the real form, email link and /auth/callback', async ({ browser }) => {
  const email = 'player12@example.test';
  const before = await must(admin.from('players').select('user_id').eq('email', email).single());
  expect(before.user_id).toBeNull();
  const { context, page } = await signInThroughForm(browser, email);
  await expect(page).toHaveURL(`${baseURL}/`); // signed-in players land on Home
  await expect(page.getByRole('heading', { name: 'Next event' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  const after = await must(admin.from('players').select('user_id').eq('email', email).single());
  expect(after.user_id).toBeTruthy();
  await context.close();
});

test('login: an email that is not on the roster gets the neutral message, no email, no account, no session', async ({ browser }) => {
  const email = 'stranger@example.test';
  const since = Date.now() - 2000;
  const { context, page } = await requestLink(browser, email);
  // Give a (wrongly) sent email time to land in Mailpit, then check none did.
  await page.waitForTimeout(3000);
  const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
    messages: { Created: string }[];
  };
  expect(list.messages.filter((m) => new Date(m.Created).getTime() >= since)).toHaveLength(0);
  expect(await authUserExists(email)).toBe(false);
  await page.goto('/me');
  await expect(page).toHaveURL(/\/login$/); // no session: bounced to the sign-in page
  const linked = await must(admin.from('players').select('id').eq('email', email));
  expect(linked).toHaveLength(0);
  await context.close();
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
  await expect(drew.getByRole('heading', { name: /^Registered\s*12$/ })).toBeVisible();
  await expect(drew.getByText('Top 6 advance')).toBeVisible();

  // --- Close registration, make groups (by handicap, 4 per group) into 3 groups, pick scorers, send the tee sheet.
  await boss.goto(`/admin/events/${w.eventId}`);
  await boss.getByRole('button', { name: 'Close registration' }).click();
  await expect(boss.getByText('registration closed', { exact: true })).toBeVisible();
  await boss.getByRole('link', { name: 'Round 1 groups' }).click();
  await boss.getByRole('button', { name: 'Make groups' }).click();
  await expect(boss.getByRole('heading', { name: /^Group \d$/ })).toHaveCount(3);
  await boss.getByLabel('First tee time').fill('08:00');
  await boss.getByRole('button', { name: 'Set start times for 3 groups' }).click();
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
  await player.addStyleTag({ content: FLOW_TABBAR });
  await player.screenshot({ path: path.join(SHOTS, 'leaderboard-cut-line.png'), fullPage: true });
});

// ---------------------------------------------------------------------------------------------
// Bracket helpers
// ---------------------------------------------------------------------------------------------
type BM = { id: string; round: number; slot: number; a: string | null; b: string | null; winner: string | null; isBye: boolean };
async function bracketMatches(): Promise<BM[]> {
  const b = await must(admin.from('brackets').select('state').eq('event_id', w.eventId).single());
  return (b as { state: { bracket: { matches: BM[] } } }).state.bracket.matches;
}
const emailOfId = (id: string) => [...w.players.values()].find((p) => p.id === id)!.email;
/** Lower index in FIELD = better play-in finish; that player wins every match. */
const seedOf = (id: string) => FIELD.findIndex((f) => f.email === emailOfId(id));

async function matchCode(key: string): Promise<{ groupId: string; code: string }> {
  const b = await must(admin.from('brackets').select('id').eq('event_id', w.eventId).single());
  const m = await must(admin.from('bracket_matches').select('group_id').eq('bracket_id', (b as { id: string }).id).eq('match_key', key).single());
  const gid = (m as { group_id: string | null }).group_id;
  expect(gid, `match ${key} has a card`).toBeTruthy();
  const g = await must(admin.from('groups').select('code').eq('id', gid!).single());
  return { groupId: gid!, code: (g as { code: string }).code };
}

/** A player in the match starts its card from the bracket page (default tee = the play-in tee). */
async function startMatchCard(browser: Browser, playerEmail: string, key: string) {
  const page = await (await ctxFor(browser, playerEmail)).newPage();
  await page.goto(`/events/${w.eventId}/bracket`);
  const article = page.getByRole('article', { name: `Match ${key}` });
  await expect(article.getByTestId('match-status')).toHaveText('Not scheduled');
  await article.getByRole('button', { name: 'Start match card' }).click();
  await article.getByRole('button', { name: 'Create card and email both players' }).click();
  // The confirmation line is replaced by the "Card code" block once the bracket refreshes; either way the link shows.
  await expect(article.getByRole('link', { name: 'Open scorecard' })).toBeVisible();
  await page.close();
  return matchCode(key);
}

test('stage 3: close play-in, draw, play the bracket, finalize, standings', async ({ browser }) => {
  const boss = await (await ctxFor(browser, COMMISSIONER)).newPage();
  const bracketAdmin = `/admin/events/${w.eventId}/bracket`;

  // --- Close the play-in: the top 6 advance.
  await boss.goto(bracketAdmin);
  await boss.getByRole('button', { name: 'Close play-in' }).click();
  await expect(boss.getByRole('heading', { name: 'Advanced (6)' })).toBeVisible();
  const advancedNames = await boss.locator('section', { hasText: 'Advanced (6)' }).locator('li').allTextContents();
  expect(advancedNames.sort()).toEqual(ADVANCERS.map(nameOf).sort());

  // --- Draw the bracket: 8 slots, 2 byes.
  boss.once('dialog', (d) => void d.accept());
  await boss.getByRole('button', { name: 'Draw bracket' }).click();
  await expect(boss.getByRole('status')).toHaveText('Bracket drawn');
  let matches = await bracketMatches();
  expect(matches).toHaveLength(7);
  expect(matches.filter((m) => m.isBye)).toHaveLength(2);
  expect(new Set(matches.filter((m) => m.round === 1).flatMap((m) => [m.a, m.b]).filter(Boolean)).size).toBe(6);

  // --- A round-1 deadline, set by the commissioner.
  await boss.getByLabel('Deadline (Central)').first().fill('2027-02-20T20:00');
  await boss.getByRole('button', { name: 'Save deadline' }).first().click();
  await expect(boss.getByRole('status')).toHaveText('Deadline saved');

  // --- Play every match: R1 (2 real matches), R2 (2), final (1). The first one entirely through the UI.
  let uiDone = false;
  for (let round = 1; round <= 3; round++) {
    matches = await bracketMatches();
    for (const m of matches.filter((x) => x.round === round && !x.isBye)) {
      expect(m.a && m.b, `${m.id} has both players`).toBeTruthy();
      const key = m.id;
      const [win, lose] = seedOf(m.a!) < seedOf(m.b!) ? [m.a!, m.b!] : [m.b!, m.a!];
      const winEmail = emailOfId(win);
      const loseEmail = emailOfId(lose);
      const { groupId, code } = await startMatchCard(browser, emailOfId(m.a!), key);
      const parOf = (hole: number) => w.pars[hole - 1]!;

      if (!uiDone) {
        // Whole match through the UI: claim, tap holes until the match is decided, sign with both PINs.
        uiDone = true;
        const phoneCtx = await anonymousPhone(browser, baseURL);
        const card = await phoneCtx.newPage();
        await card.goto(`/c/${code}`);
        await card.locator('select[aria-label="Scorer"]').selectOption({ label: nameOf(emailOfId(m.a!)) });
        await card.getByRole('button', { name: 'Keep score on this phone' }).click();
        await expect(card.getByRole('button', { name: `${nameOf(winEmail)} plus one` })).toBeVisible();
        for (let hole = 1; hole <= 10; hole++) {
          await tapHole(card, hole, [
            { name: nameOf(winEmail), gross: Math.max(1, parOf(hole) - 2), par: parOf(hole) },
            { name: nameOf(loseEmail), gross: parOf(hole) + 2, par: parOf(hole) },
          ]);
          if (hole < 10) {
            await expect(card.getByRole('region', { name: 'Sign card' })).toHaveCount(0); // not decided yet
            await expect(card.getByRole('status').first()).toBeVisible();
            await card.getByRole('button', { name: 'Next →' }).click();
          }
        }
        await expect(card.getByText(/\d+ UP|WINS|&/).first()).toBeVisible();
        await expect(card.getByRole('region', { name: 'Sign card' })).toBeVisible({ timeout: 45_000 });
        const scorerEmail = emailOfId(m.a!);
        const oppEmail = emailOfId(m.b!);
        await signUi(card, nameOf(scorerEmail), 'scorer', w.pins.get(scorerEmail)!);
        await expect(card.getByText(`Scorer: ${nameOf(scorerEmail)} ✓ signed`)).toBeVisible();
        await signUi(card, nameOf(oppEmail), 'attest', w.pins.get(oppEmail)!);
        await expect(card.getByRole('region', { name: 'Card signed' })).toBeVisible();
        await phoneCtx.close();
        // Signing a locked match card records the winner by itself.
        await expect.poll(async () => (await bracketMatches()).find((x) => x.id === key)!.winner, { timeout: 20_000 }).toBe(win);
      } else {
        // Service path: scores and signatures straight to the database, then "Record result from card" as the commissioner.
        await must(admin.from('groups').update({ scorer_player_id: m.a }).eq('id', groupId).select('id'));
        await insertScores(groupId, [
          { playerId: win, gross: Array.from({ length: 10 }, (_, i) => Math.max(1, parOf(i + 1) - 2)) },
          { playerId: lose, gross: Array.from({ length: 10 }, (_, i) => parOf(i + 1) + 2) },
        ]);
        await serviceSign(groupId, m.a!, m.b!);
        await boss.goto(bracketAdmin);
        const item = boss.locator('li', { hasText: `${key}:` });
        await item.getByRole('button', { name: 'Record result from card' }).click();
        await expect(boss.getByRole('status')).toHaveText('Result recorded');
        await expect.poll(async () => (await bracketMatches()).find((x) => x.id === key)!.winner, { timeout: 20_000 }).toBe(win);
      }
    }
  }
  matches = await bracketMatches();
  expect(matches.every((x) => x.winner)).toBe(true);
  const champion = matches.find((x) => x.round === 3)!.winner!;
  expect(emailOfId(champion)).toBe(FIELD[0]!.email);

  // --- The bracket as a player sees it.
  const viewer = await (await ctxFor(browser, 'player06@example.test')).newPage();
  await viewer.goto(`/events/${w.eventId}/bracket`);
  await expect(viewer.getByRole('region', { name: 'Final', exact: true })).toBeVisible();
  await expect(viewer.getByText('Won')).toHaveCount(5 + 2); // 5 played matches + 2 byes advance their winner
  await viewer.addStyleTag({ content: FLOW_TABBAR });
  await viewer.screenshot({ path: path.join(SHOTS, 'bracket.png'), fullPage: true });

  // --- Finalize the event.
  await boss.goto(`/admin/events/${w.eventId}`);
  boss.once('dialog', (d) => void d.accept());
  await boss.getByRole('button', { name: 'Finalize' }).click();
  await expect(boss.getByText('final', { exact: true })).toBeVisible();

  // --- Standings: exactly the six who advanced, 500 / 300 / 162.5 / 162.5 / 105 / 105; the other six absent.
  await viewer.goto('/standings');
  await expect(viewer.getByRole('heading', { name: '2027 Standings' })).toBeVisible();
  const rows = viewer.locator('tbody tr:not([data-testid="championship-cut"])');
  await expect(rows).toHaveCount(6);
  const cells = await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '')));
  expect(cells.map((c) => c[2])).toEqual(['500.00', '300.00', '162.50', '162.50', '105.00', '105.00']);
  expect(cells.map((c) => c[0])).toEqual(['1', '2', 'T3', 'T3', 'T5', 'T5']);
  expect(cells[0]![1]).toContain(nameOf(FIELD[0]!.email));
  const shown = (await rows.evaluateAll((trs) => trs.map((tr) => tr.querySelector('td:nth-child(2) [data-name]')?.textContent?.trim() ?? ''))).sort();
  expect(shown).toEqual(ADVANCERS.map(nameOf).sort());
  for (const f of FIELD.slice(6)) await expect(viewer.getByRole('link', { name: nameOf(f.email) })).toHaveCount(0);
  await viewer.addStyleTag({ content: FLOW_TABBAR });
  await viewer.screenshot({ path: path.join(SHOTS, 'standings.png'), fullPage: true });

  const ev = await must(admin.from('events').select('status').eq('id', w.eventId).single());
  expect((ev as { status: string }).status).toBe('final');
  const awards = await must(admin.from('points_awards').select('points').eq('event_id', w.eventId));
  expect((awards as { points: number }[]).map((a) => Number(a.points)).sort((x, y) => y - x)).toEqual([500, 300, 162.5, 162.5, 105, 105]);
});

test('no browser errors besides the draft event\'s expected 404', () => {
  const unexpected = browserErrors.filter((e) => !(e.includes(`/events/${w.eventId}:`) && e.includes('status of 404')));
  expect(unexpected).toEqual([]);
});
