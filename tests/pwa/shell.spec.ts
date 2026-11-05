import {expect, test} from '@playwright/test';

test('a production installation ignores the demo entry and starts empty', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', {name: 'Quick start', exact: true})).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(page.getByRole('heading', {name: 'Your workout'})).toHaveCount(0);
});

test('production shell reopens offline with a real service worker', async ({page, context}) => {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)),
    )
    .toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect(page.locator('#root')).not.toHaveText('');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('#root')).not.toBeEmpty();
  expect(await reopened.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
});
