import {expect, test} from '@playwright/test';

import {openImport} from '../navigation';
import {login, syncNow} from './helpers';

const csv =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration;Notes\n2026-01-01 10:00:00;Collision;Press;1;;kg;0;;30m;raw\n2026-01-01 10:00:00;Collision;Pull;1;0;kg;8;;30m;raw\n2026-01-01 10:00:00;Collision;Press;1;20;kg;8;;30m;raw\n2026-01-01 11:00:00;Collision;Press;1;20;kg;8;;30m;raw';
async function readHistory(
  page: import('@playwright/test').Page,
): Promise<import('../../src/state/workout').AppState> {
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(/* @vite-ignore */ path);
    const r = new WorkoutRepository();
    try {
      return await r.readState();
    } finally {
      r.close();
    }
  });
}
test('Strong import roundtrip preserves source occurrences and identical-file no-op then explicit imported-only replacement', async ({
  page,
  browser,
}) => {
  const native = {
    id: 'native-preserved',
    name: 'Native preserved',
    date: '2026-01-01T09:00:00',
    duration: 0,
    exercises: [
      {
        name: 'Press',
        type: 'weighted',
        sets: [
          {id: 'native-set', weight: 20, reps: 8, seconds: null, distance: null, completed: true},
        ],
      },
    ],
  };
  const draft = {...native, id: 'private-draft', name: 'Draft preserved'};
  await page.addInitScript((state) => localStorage.setItem('gym-log:v1', JSON.stringify(state)), {
    version: 1,
    dataset: null,
    active: draft,
    finished: [native],
    templates: [],
  });
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  const replace = async (text: string) => {
    await openImport(page);
    await page
      .getByLabel('Choose CSV file')
      .setInputFiles({name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(text)});
    await page.getByRole('button', {name: 'Replace history', exact: true}).click();
  };
  await replace(csv);
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  const local = await readHistory(page);
  expect(local.dataset?.workouts).toHaveLength(2);
  expect(local.active).toEqual(draft);
  expect(local.finished).toEqual([native]);
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await fresh.goto('/');
  await login(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  expect((await readHistory(fresh)).dataset?.workouts).toEqual(local.dataset?.workouts);
  expect((await readHistory(fresh)).active).toBeNull();
  await replace(csv);
  await expect(
    page.getByText('Identical file already imported. No history changed.', {exact: true}),
  ).toBeVisible();
  await replace(csv.replaceAll('Collision', 'Replacement'));
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await syncNow(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  const replaced = await readHistory(fresh);
  expect(replaced.dataset?.workouts).toHaveLength(2);
  expect(replaced.dataset?.workouts.every((w) => w.name === 'Replacement')).toBe(true);
  expect(replaced.finished).toEqual(local.finished);
  expect((await readHistory(page)).active).toEqual(draft);
  await replace(csv);
  await expect(
    page.getByText('History replaced. Your draft and finished workouts were kept.', {exact: true}),
  ).toBeVisible();
  await syncNow(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await syncNow(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  expect((await readHistory(fresh)).dataset?.workouts).toEqual(local.dataset?.workouts);
  const feed = await fresh.evaluate(
    async () => await (await fetch('/api/v1/sync/changes?after=0')).json(),
  );
  for (const workout of local.dataset!.workouts)
    expect(
      feed.changes
        .filter((c: any) => c.entityId === workout.id)
        .map((c: any) => [c.kind, c.revision]),
    ).toEqual([
      ['putImportedWorkout', 1],
      ['deleteImportedWorkout', 2],
      ['putImportedWorkout', 3],
    ]);
  await replace(csv);
  await expect(
    page.getByText('Identical file already imported. No history changed.', {exact: true}),
  ).toBeVisible();
  expect((await readHistory(page)).active).toEqual(draft);
  await peer.close();
});
test('interrupted Strong import resumes bounded immutable batches after reopening without duplicates', async ({
  page,
  context,
  browser,
}) => {
  const header = csv.split('\n')[0];
  const text =
    header +
    '\n' +
    Array.from(
      {length: 51},
      (_, i) =>
        `2026-01-02 10:${String(i).padStart(2, '0')}:00;Chunked;Press;1;0;kg;8;;30m;original`,
    ).join('\n');
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  let uploaded = false;
  await page.route('**/api/v1/sync/operations', async (route) => {
    const ops = route.request().postDataJSON().operations;
    expect(ops).toHaveLength(50);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    uploaded = true;
    await route.abort('failed');
  });
  await openImport(page);
  await page
    .getByLabel('Choose CSV file')
    .setInputFiles({name: 'chunks.csv', mimeType: 'text/csv', buffer: Buffer.from(text)});
  await page.getByRole('button', {name: 'Replace history', exact: true}).click();
  await expect(
    page.getByText('Offline or server unavailable · changes pending', {exact: true}),
  ).toBeVisible();
  expect(uploaded).toBe(true);
  const before = await readHistory(page);
  expect(before.dataset?.workouts).toHaveLength(51);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText('Synced', {exact: true})).toBeVisible();
  const peer = await browser.newContext();
  const fresh = await peer.newPage();
  await fresh.goto('/');
  await login(fresh);
  await expect(fresh.getByText('Synced', {exact: true})).toBeVisible();
  expect((await readHistory(fresh)).dataset?.workouts).toEqual(before.dataset?.workouts);
  const feed = await fresh.evaluate(
    async () => await (await fetch('/api/v1/sync/changes?after=0')).json(),
  );
  expect(feed.changes).toHaveLength(51);
  await peer.close();
});
