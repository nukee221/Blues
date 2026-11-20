import { expect, test } from '@playwright/test';
import path from 'node:path';
import { adminClient } from './support/env';
import { phoneAs } from './support/auth';

const admin = adminClient();
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3000}`;
const EMAIL = 'player11@example.test';

test('profile: a player adds a photo and home club on Me, and can remove the photo', async ({ browser }) => {
  const context = await phoneAs(browser, baseURL, EMAIL);
  const page = await context.newPage();
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();

  // Photo: picked from the phone, shrunk in the browser, saved, shown.
  await page.getByLabel('Choose a photo').setInputFiles(path.resolve(process.cwd(), 'e2e/fixtures/test-photo.jpg'));
  await expect(page.getByText('Photo saved.')).toBeVisible();
  const img = page.locator('img[src^="/photo/"]').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBe(256); // resized to 256 and served back
  const { data: me } = await admin.from('players').select('id, photo_version').eq('email', EMAIL).single();
  expect(Number(me!.photo_version)).toBeGreaterThan(0);

  // Home club.
  await page.getByLabel('Home club').fill('Cherokee Ridge');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Home club saved.')).toBeVisible();
  await expect(page.getByText('· Cherokee Ridge')).toBeVisible();

  // Signed-out visitors cannot fetch photos.
  const anon = await browser.newContext({ baseURL });
  const res = await anon.request.get(`/photo/${me!.id}`, { maxRedirects: 0 });
  expect(res.status()).not.toBe(200);
  await anon.close();

  // Remove.
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Photo removed.')).toBeVisible();
  await expect(page.locator('img[src^="/photo/"]')).toHaveCount(0);
  await context.close();
});
