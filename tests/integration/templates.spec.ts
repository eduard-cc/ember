import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';
import {login, syncNow} from './helpers';

async function templates(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const r = new WorkoutRepository();
    try {
      return {templates: (await r.readState()).templates, outbox: await r.db.outbox.toArray()};
    } finally {
      r.close();
    }
  });
}
test('lost real API acknowledgement retries identical operation once and offline template edits sequence across devices', async ({
  page,
  context,
  browser,
}) => {
  await login(page);
  await context.setOffline(true);
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Offline template');
  await page.getByLabel('Exercise name', {exact: true}).fill('Synthetic press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Edit template Offline template', exact: true}).click();
  await page.getByLabel('Template name').fill('Offline template edited');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  const before = await templates(page);
  expect(before.outbox).toHaveLength(2);
  await expect(page.getByText('2 changes pending', {exact: true})).toBeVisible();
  let first = true;
  const sent: string[] = [];
  await page.route('**/api/v1/sync/operations', async (route) => {
    sent.push(route.request().postData()!);
    if (first) {
      first = false;
      const result = await route.fetch();
      expect(result.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await context.setOffline(false);
  await expect(
    page.getByText('Offline or server unavailable · changes pending', {exact: true}),
  ).toBeVisible();
  expect((await templates(page)).outbox).toEqual(before.outbox);
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  expect(sent[1]).toBe(sent[0]);
  expect((await templates(page)).outbox).toHaveLength(0);
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await login(fresh);
  const data = await templates(fresh);
  expect(data.templates).toEqual(before.templates);
  const response = await fresh.evaluate(async () => {
    return await (await fetch('/api/v1/sync/changes?after=0')).json();
  });
  const id = before.templates[0].id;
  expect(
    response.changes.filter((c: any) => c.entityId === id).map((c: any) => c.revision),
  ).toEqual([1, 2]);
  await navigate(fresh, 'Workouts');
  await fresh
    .getByRole('button', {name: 'Delete template Offline template edited', exact: true})
    .click();
  await fresh.getByRole('button', {name: 'Confirm delete template', exact: true}).click();
  await syncNow(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  await syncNow(page);
  await expect(page.getByRole('heading', {name: 'No templates yet', exact: true})).toBeVisible();
  await peer.close();
});
test('stale offline template edit preserves both local edits and peer winner instead of overwriting it', async ({
  page,
  context,
  browser,
}) => {
  await login(page);
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Original');
  await page.getByLabel('Exercise name', {exact: true}).fill('Press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await login(fresh);
  await context.setOffline(true);
  const edit = async (target: Page, from: string, to: string) => {
    await navigate(target, 'Workouts');
    await target.getByRole('button', {name: 'Edit template ' + from, exact: true}).click();
    await target.getByLabel('Template name').fill(to);
    await target.getByRole('button', {name: 'Save template', exact: true}).click();
    await expect(target.getByText('Saved on this device', {exact: true})).toBeVisible();
  };
  await edit(page, 'Original', 'Local one');
  await edit(page, 'Local one', 'Local two');
  await edit(fresh, 'Original', 'Peer winner');
  await syncNow(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByText('Sync conflict or rejection · local changes kept for review/export', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('REVISION_CONFLICT', {exact: true})).toBeVisible();
  const pending = await templates(page);
  expect(pending.templates[0].name).toBe('Local two');
  expect(pending.outbox).toHaveLength(2);
  expect(pending.outbox.map((o: any) => o.payload.name)).toEqual(
    expect.arrayContaining(['Local one', 'Local two']),
  );
  await syncNow(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  expect((await templates(fresh)).templates[0].name).toBe('Peer winner');
  const feed = await fresh.evaluate(
    async () => await (await fetch('/api/v1/sync/changes?after=0')).json(),
  );
  expect(feed.changes.map((c: any) => c.revision)).toEqual([1, 2]);
  await peer.close();
});
test('API refresh never erases an unsaved in-memory template after IndexedDB rejects its write', async ({
  page,
}) => {
  await login(page);
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Kept in memory');
  await page.getByLabel('Exercise name', {exact: true}).fill('Press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'templates')
        throw new DOMException('Synthetic quota error', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout', exact: true}).click();
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  await navigate(page, 'Workouts');
  await syncNow(page);
  await expect(
    page.getByText('Not saved locally · unsaved changes are not synchronized', {exact: true}),
  ).toBeVisible();
  await page.getByRole('button', {name: 'Cancel template editing'}).click();
  await expect(page.getByRole('heading', {name: 'Kept in memory', exact: true})).toBeVisible();
});
test('rename from retained UI rejects a hidden actual API peer set-value revision without overwriting it', async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
      timeout === 5000 ? 0 : interval(handler, timeout, ...args)) as typeof window.setInterval;
  });
  await login(page);
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Displayed base');
  await page.getByLabel('Exercise name', {exact: true}).fill('Press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  const original = (await templates(page)).templates[0];
  await page.getByRole('button', {name: 'Edit template Displayed base', exact: true}).click();
  await page.getByLabel('Template name').fill('Retained rename');
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await login(fresh);
  const winner = await fresh.evaluate(async (original) => {
    const session = await (await fetch('/api/v1/session')).json();
    const payload = {
      ...original,
      exercises: original.exercises.map((e: any) => ({
        ...e,
        sets: e.sets.map((s: any) => ({...s, weight: 99})),
      })),
    };
    const response = await fetch('/api/v1/sync/operations', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken},
      body: JSON.stringify({
        version: 1,
        operations: [
          {
            operationId: crypto.randomUUID(),
            entityId: payload.id,
            kind: 'putTemplate',
            expectedRevision: 1,
            payload,
          },
        ],
      }),
    });
    const result = await response.json();
    if (result.results[0].status !== 'accepted') throw Error(JSON.stringify(result));
    return payload;
  }, original);
  // Real pull intentionally omits the hook's subsequent UI refresh.
  await page.evaluate(async () => {
    const repoPath = '/src/storage/repository.ts',
      enginePath = '/src/sync/engine.ts';
    const {WorkoutRepository} = await import(repoPath);
    const {SyncEngine} = await import(enginePath);
    const r = new WorkoutRepository();
    try {
      await new SyncEngine(r).sync(await (await fetch('/api/v1/session')).json());
    } finally {
      r.close();
    }
  });
  expect((await templates(page)).templates).toEqual([winner]);
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Template name')).toHaveValue('Retained rename');
  expect((await templates(page)).templates).toEqual([winner]);
  expect((await templates(page)).outbox).toEqual([]);
  await syncNow(page);
  await expect(page.getByLabel('Template name')).toHaveValue('Retained rename');
  const feed = await fresh.evaluate(
    async () => await (await fetch('/api/v1/sync/changes?after=0')).json(),
  );
  expect(feed.changes.map((c: any) => c.revision)).toEqual([1, 2]);
  expect(feed.changes[1].payload).toEqual(winner);
  await peer.close();
});
test('retained editor rejects peer changes after ordinary Sync now UI refresh', async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
      timeout === 5000 ? 0 : interval(handler, timeout, ...args)) as typeof window.setInterval;
  });
  await login(page);
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Displayed base');
  await page.getByLabel('Exercise name', {exact: true}).fill('Press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.getByLabel('Weight for Press set 1', {exact: true}).fill('20');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  const original = (await templates(page)).templates[0];
  await page.getByRole('button', {name: 'Edit template Displayed base', exact: true}).click();
  await page.getByLabel('Template name').fill('Retained rename');
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await login(fresh);
  const winner = await fresh.evaluate(async (original) => {
    const session = await (await fetch('/api/v1/session')).json();
    const payload = {
      ...original,
      exercises: original.exercises.map((e: any) => ({
        ...e,
        sets: e.sets.map((s: any) => ({...s, weight: 99})),
      })),
    };
    const response = await fetch('/api/v1/sync/operations', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken},
      body: JSON.stringify({
        version: 1,
        operations: [
          {
            operationId: crypto.randomUUID(),
            entityId: payload.id,
            kind: 'putTemplate',
            expectedRevision: 1,
            payload,
          },
        ],
      }),
    });
    const result = await response.json();
    if (result.results[0].status !== 'accepted') throw Error(JSON.stringify(result));
    return payload;
  }, original);
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Template name')).toHaveValue('Retained rename');
  await expect(page.getByLabel('Weight for Press set 1', {exact: true})).toHaveValue('20');
  expect((await templates(page)).templates).toEqual([winner]);
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Template name')).toHaveValue('Retained rename');
  expect((await templates(page)).templates).toEqual([winner]);
  expect((await templates(page)).outbox).toEqual([]);
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  expect((await templates(page)).templates).toEqual([winner]);
  expect((await templates(page)).outbox).toEqual([]);
  await syncNow(page);
  await expect(page.getByLabel('Template name')).toHaveValue('Retained rename');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout', exact: true}).click();
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  expect((await templates(page)).templates).toEqual([winner]);
  expect((await templates(page)).outbox).toEqual([]);
  const feed = await fresh.evaluate(
    async () => await (await fetch('/api/v1/sync/changes?after=0')).json(),
  );
  expect(feed.changes.map((c: any) => c.revision)).toEqual([1, 2]);
  expect(feed.changes[1].payload).toEqual(winner);
  await peer.close();
});
