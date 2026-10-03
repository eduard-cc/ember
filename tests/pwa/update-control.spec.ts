import {expect, test} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';

import {openSettings} from '../navigation';

test('real recovery control confirms activation without reload and defers updates during local or cross-tab drafts', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeEnabled();
  await openSettings(page);
  const file = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(file, 'utf8');
  await writeFile(
    file,
    original.replace(/gym-log-shell-([a-f0-9]+)/, 'gym-log-shell-$1-control-test'),
  );
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    await expect(page.getByRole('button', {name: 'Apply shell update'})).toBeVisible();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', {name: 'Apply shell update'}).click();
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(true);
    await page.evaluate(() => {
      (window as unknown as {marker: string}).marker = 'old page remains';
    });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', {name: 'Apply shell update'}).click();
    await expect(
      page.getByText(
        'Update activation requested. Close all gym log tabs and reopen when convenient; this page will not refresh.',
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
      original.replace(/gym-log-shell-([a-f0-9]+)/, 'gym-log-shell-$1-next-control-test'),
    );
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    await page.getByRole('button', {name: 'Close settings'}).click();
    await page.getByRole('button', {name: 'Start empty workout'}).click();
    await openSettings(page);
    await expect(page.getByRole('button', {name: 'Apply shell update'})).toBeDisabled();
    const follower = await context.newPage();
    await follower.goto('/');
    await openSettings(follower);
    await expect(follower.getByRole('button', {name: 'Apply shell update'})).toBeDisabled();
    await expect(follower.getByRole('button', {name: 'Export local backup'})).toBeDisabled();
    expect(
      await follower.evaluate(
        async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    await follower.close();
  } finally {
    await writeFile(file, original);
  }
});
