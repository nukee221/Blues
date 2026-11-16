import { expect, test } from '@playwright/test';
import { adminClient } from './support/env';
import { anonymousPhone } from './support/auth';
import { generateGroupCode } from '../src/lib/codes';

/**
 * Offline scoring (anti-goal: a dead signal must not stop a scorer). One online visit to the card as
 * the scorer, then no signal: enter scores, reload (the card must render from the service worker
 * cache with the entered scores, not a browser error page), enter more, reconnect, and the queued
 * scores reach the database. Runs after opener.spec.ts (alphabetical order) and cleans up after itself.
 */
const admin = adminClient();
const stamp = Date.now();
const code = generateGroupCode();
let eventId = '';
let groupId = '';
let players: { id: string; name: string }[] = [];
let pars: number[] = [];

test.beforeAll(async () => {
  const { data: season } = await admin.from('seasons').select('id').limit(1).single();
  const { data: tee } = await admin.from('tees').select('id').limit(1).single();
  const { data: holes } = await admin.from('holes').select('number, par').eq('tee_id', tee!.id).order('number');
  pars = holes!.map((h) => h.par);
  const { data: ev, error } = await admin
    .from('events')
    .insert({ season_id: season!.id, name: `E2E offline ${stamp}`, event_type: 'regular', status: 'in_progress', handicap_mode: 'gross' })
    .select('id')
    .single();
  if (error) throw error;
  eventId = ev!.id;
  const { data: round, error: rErr } = await admin.from('rounds').insert({ event_id: eventId, round_number: 1, tee_id: tee!.id, kind: 'stroke' }).select('id').single();
  if (rErr) throw rErr;
  const { data: ps } = await admin.from('players').select('id, name').in('email', ['player02@example.test', 'player03@example.test']).order('email');
  players = ps!;
  const { data: g, error: gErr } = await admin.from('groups').insert({ round_id: round!.id, code }).select('id').single();
  if (gErr) throw gErr;
  groupId = g!.id;
  const gp = await admin.from('group_players').insert(players.map((p) => ({ group_id: groupId, player_id: p.id, playing_handicap: 0 })));
  if (gp.error) throw gp.error;
});

test.afterAll(async () => {
  if (eventId) {
    await admin.from('audit_log').delete().eq('entity_id', groupId);
    await admin.from('events').delete().eq('id', eventId);
  }
});

test('offline: one online visit, then enter scores, reload with no signal, enter more, reconnect: all scores reach the database', async ({ browser }) => {
  const context = await anonymousPhone(browser, `http://127.0.0.1:${process.env.E2E_PORT ?? 3000}`);
  const page = await context.newPage();
  const [p1, p2] = players as [{ id: string; name: string }, { id: string; name: string }];

  // --- one online visit, as the scorer
  await page.goto(`/c/${code}`);
  await page.getByRole('combobox', { name: 'Scorer' }).selectOption(p1.id);
  await page.getByRole('button', { name: 'Keep score on this phone' }).click();
  await expect(page.getByRole('button', { name: `${p1.name} plus one` })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // The page told the service worker to cache itself: wait for it (this is what "one visit is enough" means).
  await expect
    .poll(
      () =>
        page.evaluate(async (c) => {
          const keys = await caches.keys();
          let doc = false;
          let statics = 0;
          for (const k of keys) {
            for (const r of await (await caches.open(k)).keys()) {
              const u = new URL(r.url);
              if (u.pathname === `/c/${c}`) doc = true;
              if (u.pathname.startsWith('/_next/static/')) statics++;
            }
          }
          return doc && statics > 0;
        }, code),
      { timeout: 30_000, message: 'the service worker never cached the scorecard page and its assets' },
    )
    .toBe(true);

  const tap = async (hole: number) => {
    for (const p of [p1, p2]) await page.getByRole('button', { name: `${p.name} plus one` }).click(); // par
    await expect(page.getByLabel(`${p1.name} gross`)).toHaveText(String(pars[hole - 1]));
  };

  // --- hole 1 online (proves the happy path), then the signal dies
  await tap(1);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await context.setOffline(true);

  // --- holes 2 and 3 with no signal
  await page.getByRole('button', { name: 'Next →' }).click();
  await tap(2);
  await page.getByRole('button', { name: 'Next →' }).click();
  await tap(3);
  await expect(page.getByRole('status')).toContainText('Waiting for signal');

  // --- reload with no signal: the card renders (not a browser error page) with the entered scores
  await page.reload();
  await expect(page.getByRole('button', { name: `${p1.name} plus one` })).toBeVisible();
  await page.locator('summary', { hasText: 'Go to hole' }).click();
  for (const hole of [1, 2, 3]) {
    await page.getByRole('button', { name: new RegExp(`^Hole ${hole}(, scored)?$`) }).click();
    await expect(page.getByLabel(`${p1.name} gross`)).toHaveText(String(pars[hole - 1]));
    await expect(page.getByLabel(`${p2.name} gross`)).toHaveText(String(pars[hole - 1]));
  }
  await expect(page.getByRole('status')).toContainText('Waiting for signal');

  // --- more scores after the reload, still offline
  await page.getByRole('button', { name: 'Next →' }).click(); // hole 4
  await tap(4);

  // --- back online: everything queued reaches the database
  await context.setOffline(false);
  await expect
    .poll(
      async () => {
        const { data } = await admin.from('scores').select('player_id, hole, gross').eq('group_id', groupId);
        return (data ?? []).length;
      },
      { timeout: 60_000, message: 'queued scores never reached the database' },
    )
    .toBe(8);
  const { data: stored } = await admin.from('scores').select('player_id, hole, gross').eq('group_id', groupId);
  for (const s of stored!) expect(s.gross).toBe(pars[s.hole - 1]);
  expect(new Set(stored!.map((s) => s.hole))).toEqual(new Set([1, 2, 3, 4]));
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 30_000 });
  await context.close();
});
