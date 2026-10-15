import {expect, test} from '@playwright/test';

import {demoTemplates} from '../../src/domain/demo';
import {navigate} from '../navigation';
import {login, revokeAndLock, syncNow} from './helpers';

test('template preview is unmounted when local trust is revoked', async ({page}) => {
  await page.addInitScript((templates) => {
    localStorage.setItem(
      'gym-log:v1',
      JSON.stringify({
        version: 1,
        dataset: null,
        active: null,
        finished: [],
        templates,
      }),
    );
  }, demoTemplates);
  await login(page);
  await page
    .getByRole('button', {name: `Open template ${demoTemplates[0].name}`, exact: true})
    .click();
  await expect(page.getByRole('dialog', {name: demoTemplates[0].name, exact: true})).toBeVisible();
  await revokeAndLock(page);
  await expect(page.locator('main')).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', {name: `Start template ${demoTemplates[0].name}`}),
  ).toHaveCount(0);
});

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
  await page.clock.setFixedTime(new Date('2026-01-01T12:45:00'));
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await context.setOffline(true);
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Finish workout', exact: true}).click();
  await page.getByRole('button', {name: 'Save finished workout', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await page.close();
  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await fresh.goto('/');
  await login(fresh);
  await expect(fresh.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await navigate(fresh, 'History');
  await expect(fresh.getByText('Offline finished', {exact: true}).first()).toBeVisible();
  await expect(
    fresh.locator('.history-card', {hasText: 'Offline finished'}).locator('.eyebrow'),
  ).toContainText('· 45 MIN');
  await navigate(fresh, 'Workouts');
  await expect(fresh.getByRole('heading', {name: 'Quick start', exact: true})).toBeVisible();
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
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
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-sync',
    'Offline or server unavailable · changes pending',
  );
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  expect(await count()).toBe(0);
  await revokeAndLock(page);
  await expect(page.locator('main')).toBeHidden();
  await page.goto('/?demo=1');
  await expect(page.locator('main')).toBeHidden();
  await page.goto('/');
  await expect(page.locator('main')).toBeHidden();
  await context.setOffline(true);
  // Navigation lives inside the locked workspace, so no view of retained data is reachable.
  await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeHidden();
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.locator('main')).toBeVisible();
  await revokeAndLock(page);
  await expect(follower.locator('main')).toBeHidden();
});
test('an open Previous evidence dialog closes when local trust is revoked mid-workout', async ({
  page,
}) => {
  await page.addInitScript(
    (active) =>
      localStorage.setItem(
        'gym-log:v1',
        JSON.stringify({version: 1, dataset: null, active, finished: [], templates: []}),
      ),
    {...active, id: 'evidence-' + crypto.randomUUID(), name: 'Evidence while locked'},
  );
  await page.goto('/');
  await login(page);
  await page
    .getByRole('button', {name: /^Previous for .* set 1$/})
    .first()
    .click();
  const evidence = page.getByRole('dialog');
  await expect(evidence).toBeVisible();
  await revokeAndLock(page);
  await expect(page.locator('main')).toBeHidden();
  // Portaled dialogs escape <main hidden>; locked history must not stay on screen.
  await expect(evidence).toHaveCount(0);
});
