import {type Page, expect, test} from '@playwright/test';

import {demoTemplates} from '../../src/domain/demo';
import {login, syncNow} from './helpers';

const synthetic = (id: string, name: string) => ({
  ...demoTemplates[0],
  id,
  name,
  exercises: demoTemplates[0].exercises.map((e) => ({
    ...e,
    sets: e.sets.map((s, i) => ({
      ...s,
      id: id + ':' + e.name + ':' + i,
      completed: true,
      original: {Weight: 'synthetic 20.0', Reps: '5'},
    })),
  })),
});
const imported = synthetic('recovery-import', 'Recovered imported');
const native = synthetic('recovery-native', 'Recovered native');
const template = synthetic('recovery-template', 'Recovered template');
const draft = synthetic('recovery-draft', 'Recovered local draft');
const state = {
  version: 1,
  dataset: {
    sourceLabel: 'Synthetic recovery CSV',
    workouts: [imported],
    warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
  },
  finished: [native],
  templates: [template],
  active: draft,
};

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const r = new WorkoutRepository();
    try {
      return {
        state: await r.readState(),
        operations: await r.db.outbox.toArray(),
        revisions: await r.db.syncState.toArray(),
        sources: await r.db.importSources.toArray(),
      };
    } finally {
      r.close();
    }
  });
}
test('real app backup file restore authenticates safely and preserves imported/native identities with visible server conflicts', async ({
  page,
  browser,
}) => {
  await page.addInitScript((state) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('gym-log:v1', JSON.stringify(state));
      localStorage.setItem('seeded', 'yes');
    }
  }, state);
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Recovery settings'}).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export local backup'}).click();
  const file = await downloading;
  const context = await browser.newContext();
  const clone = await context.newPage();
  await clone.goto('/');
  await clone.getByRole('button', {name: 'Start empty workout'}).click();
  await clone.getByLabel('WORKOUT NAME').fill('Prior local draft');
  await expect(clone.getByText('Saved on this device', {exact: true})).toBeVisible();
  await clone.getByRole('button', {name: 'Recovery settings'}).click();
  await clone.getByLabel('Import backup JSON').setInputFiles((await file.path())!);
  await clone
    .getByLabel('I understand this replaces local data and resets draft ownership')
    .check();
  await clone.getByRole('button', {name: 'Restore backup locally'}).click();
  await expect(clone.getByText(/Restored locally\./)).toBeVisible();
  await expect(clone.locator('main')).toBeHidden();
  let local = await snapshot(clone);
  expect(local.state.active).toEqual(draft);
  expect(local.state.finished).toEqual([native]);
  expect(local.state.dataset?.workouts).toEqual([imported]);
  expect(
    local.operations
      .map((o: {entityId: string; kind: string; expectedRevision: number | null}) => [
        o.entityId,
        o.kind,
        o.expectedRevision,
      ])
      .sort(),
  ).toEqual([
    ['recovery-import', 'putImportedWorkout', null],
    ['recovery-native', 'putWorkout', null],
    ['recovery-template', 'putTemplate', null],
  ]);
  await login(clone);
  await expect(
    clone.getByText('Sync conflict or rejection · local changes kept for review/export', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(clone.getByLabel('WORKOUT NAME')).toHaveValue('Recovered local draft');
  local = await snapshot(clone);
  expect(local.state.finished).toEqual([native]);
  expect(local.state.dataset?.workouts).toEqual([imported]);
  const server = await clone.evaluate(
    async () => (await (await fetch('/api/v1/sync/changes?after=0&limit=100')).json()).changes,
  );
  expect(server.map((c: {entityId: string; kind: string}) => [c.entityId, c.kind]).sort()).toEqual([
    ['recovery-import', 'putImportedWorkout'],
    ['recovery-native', 'putWorkout'],
    ['recovery-template', 'putTemplate'],
  ]);
  await context.close();
});
test('restore waits for a real in-flight sync response and prevents edits until its deliberate draft reload', async ({
  page,
}) => {
  await page.addInitScript((state) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('gym-log:v1', JSON.stringify(state));
      localStorage.setItem('seeded', 'yes');
    }
  }, state);
  await page.goto('/');
  await login(page);
  await expect(page.getByText('Synced', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Recovery settings'}).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export local backup'}).click();
  const file = await downloading;
  await page.getByLabel('WORKOUT NAME').fill('Draft before restore');
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.getByLabel('Import backup JSON').setInputFiles((await file.path())!);
  await page.getByLabel('I understand this replaces local data and resets draft ownership').check();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route('**/api/v1/sync/changes?*', async (route) => {
    intercepted();
    await gate;
    await route.continue();
  });
  try {
    await syncNow(page);
    await started;
    await page.getByRole('button', {name: 'Restore backup locally'}).click();
    await expect(page.getByLabel('WORKOUT NAME')).toBeDisabled();
    await expect(page.getByRole('button', {name: 'Restore backup locally'})).toBeDisabled();
    expect((await snapshot(page)).state.active?.name).toBe('Draft before restore');
    release();
    await expect(page.getByText(/Restored locally\./)).toBeVisible();
    await expect(page.getByLabel('WORKOUT NAME')).toHaveValue(draft.name);
    await expect(page.getByLabel('WORKOUT NAME')).toBeEnabled();
  } finally {
    release();
    await page.unroute('**/api/v1/sync/changes?*');
  }
});
test('downloaded recovery file creates exact imported/native records on an empty server and fresh peer, never a synced draft', async ({
  page,
  browser,
}) => {
  await page.addInitScript((state) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('gym-log:v1', JSON.stringify(state));
      localStorage.setItem('seeded', 'yes');
    }
  }, state);
  await page.goto('/');
  await page.getByRole('button', {name: 'Recovery settings'}).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export local backup'}).click();
  const file = await downloading;
  const context = await browser.newContext();
  const clone = await context.newPage();
  await clone.goto('/');
  await clone.getByRole('button', {name: 'Recovery settings'}).click();
  await clone.getByLabel('Import backup JSON').setInputFiles((await file.path())!);
  await clone
    .getByLabel('I understand this replaces local data and resets draft ownership')
    .check();
  await clone.getByRole('button', {name: 'Restore backup locally'}).click();
  await expect(clone.getByLabel('WORKOUT NAME')).toHaveValue(draft.name);
  await login(clone);
  await expect(clone.getByText('Synced', {exact: true})).toBeVisible();
  const restored = await snapshot(clone);
  expect(restored.operations).toEqual([]);
  expect(restored.state.active).toEqual(draft);
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await peer.goto('/');
  await login(peer);
  await expect(peer.getByText('Synced', {exact: true})).toBeVisible();
  const remote = await snapshot(peer);
  expect(remote.state.finished).toEqual([native]);
  expect(remote.state.dataset?.workouts).toEqual([imported]);
  expect(remote.state.templates).toEqual([template]);
  expect(remote.state.active).toBeNull();
  const local = await snapshot(clone);
  expect(local.state.dataset?.workouts).toEqual([imported]);
  expect(local.state.finished).toEqual([native]);
  await peerContext.close();
  await context.close();
});
