import {expect, test} from '@playwright/test';

test('fresh installation connects automatically without an app password or permanent sync card', async ({
  page,
}) => {
  let bootstraps = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/session')) {
      if (request.method() === 'GET' && !bootstraps) return route.fulfill({status: 401, json: {}});
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({});
        expect(request.headers()['tailscale-user-login']).toBeUndefined();
        bootstraps++;
      }
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    }
    return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Server password')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toHaveCount(0);
  await expect(page.locator('section.notice[aria-label="Server synchronization"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => bootstraps).toBe(1);
});

test('online wake reacquires an expired session before syncing pending changes', async ({page}) => {
  let bootstraps = 0;
  let expired = false;
  let connected = false;
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().url().endsWith('/session')) {
      if (route.request().method() === 'GET' && !connected)
        return route.fulfill({status: 401, json: {}});
      if (route.request().method() === 'POST') {
        bootstraps++;
        connected = true;
      }
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    }
    if (expired) return route.fulfill({status: 401, json: {}});
    return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  expired = true;
  connected = false;
  await page.route('**/api/v1/session', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({status: 401, json: {}});
    bootstraps++;
    expired = false;
    return route.fulfill({json: {ownerId: 'owner', csrfToken: 'renewed-csrf'}});
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => bootstraps, {timeout: 2000}).toBe(2);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
});

test('restored owner trust reconnects automatically on wake', async ({page}) => {
  let sessions = 0;
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().url().endsWith('/session')) {
      sessions++;
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    }
    return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    await repository.db.meta.put({key: 'local-trust', value: false});
    repository.close();
  });
  await expect(page.locator('main')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('main')).toBeVisible();
  expect(sessions).toBe(2);
});

test('unavailable server keeps trusted local drafts and pending edits across reopen', async ({
  page,
}) => {
  let unavailable = false;
  let bootstraps = 0;
  await page.route('**/api/v1/**', async (route) => {
    if (unavailable) return route.abort('failed');
    if (route.request().url().endsWith('/session')) {
      if (route.request().method() === 'GET' && !bootstraps)
        return route.fulfill({status: 401, json: {}});
      if (route.request().method() === 'POST') bootstraps++;
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    }
    return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  unavailable = true;
  await page.getByRole('button', {name: 'Start empty workout', exact: true}).click();
  await page.getByLabel('WORKOUT NAME').fill('Offline retained draft');
  await page.getByLabel('WORKOUT NAME').blur();
  await page.getByRole('button', {name: 'Templates', exact: true}).click();
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Offline retained template');
  await page.getByLabel('Exercise name', {exact: true}).fill('Press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Offline retained draft');
  await expect(
    page.getByText('Offline or server unavailable · changes pending', {exact: true}),
  ).toBeVisible();
  await page.getByRole('button', {name: 'Templates', exact: true}).click();
  await expect(
    page.getByRole('heading', {name: 'Offline retained template', exact: true}),
  ).toBeVisible();
  const pending = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      return await repository.db.outbox.count();
    } finally {
      repository.close();
    }
  });
  expect(pending).toBe(1);
  expect(bootstraps).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('demo installation never attempts server session bootstrap', async ({page}) => {
  let requests = 0;
  await page.route('**/api/v1/**', async (route) => {
    requests++;
    await route.abort('failed');
  });
  await page.goto('/?demo=1');
  await expect(page.getByLabel('WORKOUT NAME')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.goto('/');
  await expect(page.getByText('Local only', {exact: true})).toBeVisible();
  expect(requests).toBe(0);
});
