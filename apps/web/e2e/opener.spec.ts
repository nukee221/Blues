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
