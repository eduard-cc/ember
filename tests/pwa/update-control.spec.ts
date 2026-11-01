import {expect, test} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';

import {navigate, openSettings} from '../navigation';

test('real app-update control confirms activation without reload and defers updates during local or cross-tab drafts', async ({
  page,
  context,
}) => {
  // Hold one real session request to exercise cancellation while sync temporarily disables update.
  let holdSync = false;
  let releaseSync: () => void = () => undefined;
  await page.route('**/api/v1/session', async (route) => {
    if (holdSync)
      await new Promise<void>((resolve) => {
        releaseSync = resolve;
      });
    await route.fulfill({status: 503, json: {message: 'Synthetic unavailable sync'}});
  });
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeEnabled();
  await openSettings(page);
  const file = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace(/ember-shell-([a-f0-9]+)/, 'ember-shell-$1-control-test'));
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    await expect(page.getByRole('button', {name: 'Apply shell update'})).toBeVisible();
    await page.getByRole('button', {name: 'Apply shell update'}).click();
    const confirmation = page.getByRole('dialog', {name: 'Apply the new app shell?', exact: true});
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('button', {name: 'Apply update', exact: true}),
    ).toBeEnabled();
    holdSync = true;
    const sessionRequest = page.waitForRequest('**/api/v1/session');
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await sessionRequest;
    await expect(
      confirmation.getByRole('button', {name: 'Apply update', exact: true}),
    ).toBeDisabled();
    await confirmation.getByRole('button', {name: 'Not now', exact: true}).click();
    await expect(confirmation).toBeHidden();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    holdSync = false;
    releaseSync();
    await expect(page.getByRole('button', {name: 'Apply shell update', exact: true})).toBeFocused();
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(true);
    await page.evaluate(() => {
      (window as unknown as {marker: string}).marker = 'old page remains';
    });
    await page.getByRole('button', {name: 'Apply shell update'}).click();
    await confirmation.getByRole('button', {name: 'Apply update', exact: true}).click();
    await expect(confirmation).toBeHidden();
    await expect(
      page.getByText(
        'Update activation requested. Close all Ember tabs and reopen when convenient; this page will not refresh.',
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(false);
    expect(await page.evaluate(() => (window as unknown as {marker: string}).marker)).toBe(
      'old page remains',
    );
    await writeFile(
      file,
      original.replace(/ember-shell-([a-f0-9]+)/, 'ember-shell-$1-next-control-test'),
    );
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    await navigate(page, 'Workouts');
    await page.getByRole('button', {name: 'Start empty workout'}).click();
    await openSettings(page);
    await expect(page.getByRole('button', {name: 'Apply shell update'})).toBeDisabled();
    const follower = await context.newPage();
    await follower.goto('/');
    await openSettings(follower);
    await expect(follower.getByRole('button', {name: 'Apply shell update'})).toBeDisabled();
    expect(
      await follower.evaluate(
        async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    await follower.close();
  } finally {
    releaseSync();
    await writeFile(file, original);
  }
});
