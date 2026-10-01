import {expect, test} from '@playwright/test';

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
  const shell = await page.locator('#root').innerText();
  expect(shell.length).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('#root')).not.toBeEmpty();
  expect(await reopened.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
});
