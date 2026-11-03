import {expect, test} from '@playwright/test';

import {addExercise, navigate} from '../navigation';

const syntheticHistory = {
  id: 'synthetic-history',
  name: 'Synthetic history',
  date: '2026-01-02T10:00:00',
  duration: 30,
  exercises: [
    {
      name: 'Bench Press (Barbell)',
      type: 'weighted',
      sets: [{id: 'synthetic-set', weight: 60, reps: 5, seconds: null, distance: null}],
    },
  ],
};

const change = (n: number) => ({
  entityId: `${syntheticHistory.id}-${n}`,
  kind: 'putImportedWorkout',
  revision: 1,
  changeSeq: n,
  payload: {...syntheticHistory, id: `${syntheticHistory.id}-${n}`, name: `Synthetic history ${n}`},
});

test('fresh installation connects automatically, keeps its storage and says history is downloading until all of it arrived', async ({
  page,
}) => {
  test.slow();
  await page.addInitScript(() => {
    const w = window as unknown as {persistRequests: number};
    w.persistRequests = 0;
    navigator.storage.persisted = async () => false;
    navigator.storage.persist = async () => (w.persistRequests++, true);
  });
  let bootstraps = 0;
  let serverUp = true;
  let releaseSession!: () => void;
  const sessionHeld = new Promise<void>((resolve) => (releaseSession = resolve));
  let releaseFeed!: () => void;
  const feedHeld = new Promise<void>((resolve) => (releaseFeed = resolve));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/session')) {
      await sessionHeld;
      if (request.method() === 'GET' && !bootstraps) return route.fulfill({status: 401, json: {}});
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({});
        expect(request.headers()['tailscale-user-login']).toBeUndefined();
        bootstraps++;
      }
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    }
    if (request.method() === 'POST') {
      if (!serverUp) return route.abort('failed');
      return route.fulfill({
        json: {
          results: request
            .postDataJSON()
            .operations.map((operation: {operationId: string; entityId: string}) => ({
              operationId: operation.operationId,
              entityId: operation.entityId,
              status: 'accepted',
              revision: 1,
              changeSeq: 3,
            })),
        },
      });
    }
    if (request.url().includes('after=0')) {
      await feedHeld;
      return route.fulfill({json: {changes: [change(1)], nextCursor: 1, hasMore: true}});
    }
    if (request.url().includes('after=1&')) {
      if (!serverUp) return route.abort('failed');
      return route.fulfill({json: {changes: [change(2)], nextCursor: 2, hasMore: false}});
    }
    return route.fulfill({json: {changes: [], nextCursor: 2, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Start empty workout', exact: true})).toBeEnabled();
  await expect(page.getByRole('region', {name: 'Connecting…', exact: true})).toBeVisible();
  releaseSession();
  const download = page.getByRole('status', {name: 'History download'});
  await expect(download).toHaveText('Downloading your workout history from your server…');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as {persistRequests: number}).persistRequests),
    )
    .toBeGreaterThan(0);
  // The connection drops after the first page: the partial history is labelled, also after reopening.
  serverUp = false;
  releaseFeed();
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-sync',
    'Offline or server unavailable · changes pending',
  );
  await expect(download).toHaveText(
    'Your workout history has not finished downloading. It continues when your server is reachable.',
  );
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Queued during download');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(page.getByRole('region', {name: 'History download'})).toContainText(
    '1 change waiting to sync',
  );
  await page.reload();
  await expect(download).toBeVisible();
  await expect(page.getByRole('region', {name: 'History download'})).toContainText(
    '1 change waiting to sync',
  );
  serverUp = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await expect(download).toHaveCount(0);
  await navigate(page, 'History');
  for (const n of [1, 2])
    await expect(page.getByRole('heading', {name: `Synthetic history ${n}`})).toBeVisible();
  await expect(page.getByLabel('Server password')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toHaveCount(0);
  await expect(page.getByRole('status', {name: 'Server synchronization'})).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await expect(download).toHaveCount(0);
  expect(bootstraps).toBe(1);
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  unavailable = true;
  await page.getByRole('button', {name: 'Start empty workout', exact: true}).click();
  await page.getByLabel('WORKOUT NAME').fill('Offline retained draft');
  await page.getByLabel('WORKOUT NAME').blur();
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Offline retained template');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Offline retained draft');
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-sync',
    'Offline or server unavailable · changes pending',
  );
  await expect(page.getByRole('region', {name: 'Server unavailable'})).toContainText(
    '1 change waiting to sync',
  );
  await navigate(page, 'Workouts');
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Local only');
  expect(requests).toBe(0);
});

for (const status of ['conflict', 'rejected'] as const) {
  test(`${status} keeps local work without continuously polling`, async ({page}) => {
    await page.addInitScript(() => {
      const interval = window.setInterval;
      window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
        delay === 5000 ? 0 : interval(handler, delay, ...args)) as typeof window.setInterval;
    });
    let uploads = 0;
    let feeds = 0;
    await page.route('**/api/v1/**', async (route) => {
      if (route.request().url().endsWith('/session'))
        return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
      if (route.request().method() === 'POST') {
        uploads++;
        return route.fulfill({
          json: {
            results: route
              .request()
              .postDataJSON()
              .operations.map((operation: {operationId: string; entityId: string}) => ({
                operationId: operation.operationId,
                entityId: operation.entityId,
                status,
                revision: null,
                changeSeq: null,
                errorCode: 'REVISION_CONFLICT',
              })),
          },
        });
      }
      feeds++;
      return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
    });
    await page.goto('/');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
    await page.getByRole('button', {name: 'Create template', exact: true}).click();
    await page.getByLabel('Template name').fill('Retained template');
    await addExercise(page, 'Bench Press (Barbell)');
    await page.getByRole('button', {name: 'Save template', exact: true}).click();
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-sync',
      /Sync conflict or rejection/,
    );
    await expect(page.getByRole('region', {name: 'Changes not synced'})).toContainText(
      'REVISION_CONFLICT',
    );
    const completedFeeds = feeds;
    await page.waitForTimeout(1000);
    expect(feeds).toBe(completedFeeds);
    expect(uploads).toBe(1);
    const retained = await page.evaluate(async () => {
      const path = '/src/storage/repository.ts';
      const {WorkoutRepository} = await import(path);
      const repository = new WorkoutRepository();
      try {
        return {
          pending: await repository.db.outbox.count(),
          issues: (await repository.db.syncState.toArray()).filter((r: {key: string}) =>
            r.key.startsWith('issue:'),
          ).length,
        };
      } finally {
        repository.close();
      }
    });
    expect(retained).toEqual({pending: 1, issues: 1});
  });
}

test('a new template syncs immediately in the background without a wake or manual control', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      delay === 5000 ? 0 : interval(handler, delay, ...args)) as typeof window.setInterval;
  });
  let uploaded = 0;
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().url().endsWith('/session'))
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    if (route.request().method() === 'POST') {
      const operations = route.request().postDataJSON().operations;
      uploaded += operations.length;
      return route.fulfill({
        json: {
          results: operations.map((operation: {operationId: string; entityId: string}) => ({
            operationId: operation.operationId,
            entityId: operation.entityId,
            status: 'accepted',
            revision: 1,
            changeSeq: uploaded,
          })),
        },
      });
    }
    return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Immediate sync template');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect.poll(() => uploaded, {timeout: 1200}).toBe(1);
});
