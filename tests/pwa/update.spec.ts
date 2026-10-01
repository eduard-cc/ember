import {expect, test} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';

test('a new worker waits for explicit activation without refreshing the open page', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.evaluate(() => {
    (window as unknown as {pwaPageMarker: string}).pwaPageMarker = 'synthetic unsaved page';
  });
  const path = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(path, 'utf8');
  // Simulate deploying a new shell version, using the actual preview server and SW lifecycle.
  await writeFile(
    path,
    original.replace(/gym-log-shell-([a-f0-9]+)/, 'gym-log-shell-$1-test-update'),
  );
  try {
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state,
        ),
      )
      .toBe('installed');
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.active?.state,
      ),
    ).toBe('activated');
    await page.evaluate(async () => {
      (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage({
        type: 'ACTIVATE_SAVED_SHELL',
      });
    });
    await expect
      .poll(() =>
        page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
        ),
      )
      .toBe(false);
    expect(
      await page.evaluate(() => (window as unknown as {pwaPageMarker: string}).pwaPageMarker),
    ).toBe('synthetic unsaved page');
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
  } finally {
    await writeFile(path, original);
  }
});
