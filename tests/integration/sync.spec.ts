import {expect, test} from '@playwright/test';

import {demoTemplates} from '../../src/domain/demo';
import {login, revokeAndLock, syncNow} from './helpers';

const active = {
  ...demoTemplates[0],
  id: 'offline-' + crypto.randomUUID(),
  name: 'Offline finished',
  date: '2026-01-01T12:00:00',
};
test('offline finish survives reopen and fresh independent peer sees only completed history', async ({
  page,
  context,
  browser,
}) => {
  await page.addInitScript((active) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem(
        'gym-log:v1',
        JSON.stringify({version: 1, dataset: null, active, finished: [], templates: []}),
      );
      localStorage.setItem('seeded', 'yes');
    }
  }, active);
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Finish workout', exact: true}).click();
  await page.getByRole('button', {name: 'Save finished workout', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Workout history'})).toBeVisible();
  await page.close();
  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText('Synced', {exact: true})).toBeVisible();
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await fresh.goto('/');
  await login(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  await fresh.getByRole('button', {name: 'History', exact: true}).click();
  await expect(fresh.getByText('Offline finished', {exact: true}).first()).toBeVisible();
  await fresh.getByRole('button', {name: 'Workout', exact: true}).click();
  await expect(fresh.getByRole('heading', {name: 'Ready for your next workout'})).toBeVisible();
  await peer.close();
});
test('revoked legacy session retains pending changes and untrusted local data stays hidden until restored', async ({
  page,
  context,
}) => {
  await page.addInitScript(
    (active) =>
      localStorage.setItem(
        'gym-log:v1',
        JSON.stringify({version: 1, dataset: null, active, finished: [], templates: []}),
      ),
    {...active, id: 'revoked-' + crypto.randomUUID(), name: 'Pending after revocation'},
  );
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await page.evaluate(async () => {
    const session = await (await fetch('/api/v1/session')).json();
    await fetch('/api/v1/session', {
      method: 'DELETE',
      headers: {'X-CSRF-Token': session.csrfToken},
    });
  });
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await page.getByRole('button', {name: 'Finish workout', exact: true}).click();
  await page.getByRole('button', {name: 'Save finished workout', exact: true}).click();
  await syncNow(page);
  await expect(
    page.getByText('Offline or server unavailable · changes pending', {exact: true}),
  ).toBeVisible();
  const count = () =>
    page.evaluate(async () => {
      const path = '/src/storage/repository.ts';
      const {WorkoutRepository} = await import(path);
      const r = new WorkoutRepository();
      try {
        return await r.db.outbox.count();
      } finally {
        r.close();
      }
    });
  expect(await count()).toBe(1);
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  expect(await count()).toBe(0);
  await revokeAndLock(page);
  await expect(page.locator('main')).toBeHidden();
  await page.goto('/?demo=1');
  await expect(page.locator('main')).toBeHidden();
  await page.goto('/');
  await expect(page.locator('main')).toBeHidden();
  await context.setOffline(true);
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await expect(page.locator('main')).toBeHidden();
  await context.setOffline(false);
  await login(page);
  await expect(page.locator('main')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('csrfToken');
});
test('revoked local trust hides retained data in a second same-origin tab too', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.locator('main')).toBeVisible();
  await revokeAndLock(page);
  await expect(follower.locator('main')).toBeHidden();
});
