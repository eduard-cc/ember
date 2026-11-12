import {expect, test} from '@playwright/test';
import {createRequire} from 'node:module';

import {demoTemplates} from '../../src/domain/demo';
import {navigate} from '../navigation';
import {login} from './helpers';

const completed = (id: string, name: string) => ({
  ...demoTemplates[0],
  id,
  name,
  date: '2026-01-01T12:00:00',
  exercises: demoTemplates[0].exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set, i) => ({
      ...set,
      id: id + ':' + exercise.name + ':' + i,
      completed: true,
    })),
  })),
});
const old = completed('reset-old-history', 'Old synced session');
const seed = completed('reset-new-history', 'New imported session');
const draft = {...demoTemplates[0], id: 'reset-active', name: 'Active draft kept'};

test('dataset reset clears stale installed history and outbox without losing the active draft', async ({
  page,
  browser,
}) => {
  await page.addInitScript(
    (state) => {
      if (!localStorage.getItem('seeded')) {
        localStorage.setItem('ember:v1', JSON.stringify(state));
        localStorage.setItem('seeded', 'yes');
      }
    },
    {version: 1, dataset: null, finished: [old], templates: [demoTemplates[0]], active: draft},
  );
  await login(page);
  const url = new URL(process.env.EMBER_TEST_DATABASE_URL!);
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    !/^\/ember_browser_test_\d+_\d+$/.test(url.pathname)
  )
    throw new Error('Reset fixture requires a disposable browser-test database');
  const require = createRequire(new URL('../../../api/package.json', import.meta.url));
  const {Pool} = require('pg');
  const {resetDataset} = require('./dist/sync/reset.js');
  const database = new Pool({connectionString: url.toString()});
  try {
    await resetDataset(
      {
        transaction: async (job: (tx: unknown) => Promise<void>) => {
          const tx = await database.connect();
          try {
            await tx.query('BEGIN');
            await job(tx);
            await tx.query('COMMIT');
          } catch (error) {
            await tx.query('ROLLBACK');
            throw error;
          } finally {
            tx.release();
          }
        },
      },
      'owner',
      [seed],
    );
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
    const snapshot = () =>
      page.evaluate(async () => {
        const path = '/src/storage/repository.ts';
        const {WorkoutRepository} = await import(path);
        const repo = new WorkoutRepository();
        try {
          return {state: await repo.readState(), pending: await repo.db.outbox.toArray()};
        } finally {
          repo.close();
        }
      });
    await expect
      .poll(async () => (await snapshot()).state.dataset?.workouts.map((w: {id: string}) => w.id))
      .toEqual([seed.id]);
    const state = await snapshot();
    expect(state.state.active).toEqual(draft);
    expect(state.state.finished).toEqual([]);
    expect(state.state.templates).toEqual([]);
    expect(state.pending).toEqual([]);
    await page.reload();
    await expect(page.getByLabel('WORKOUT NAME')).toHaveValue(draft.name);
    const peer = await browser.newContext();
    try {
      const fresh = await peer.newPage();
      await login(fresh);
      await navigate(fresh, 'Workouts');
      await expect(fresh.getByRole('button', {name: 'Start empty workout'})).toBeVisible();
      const rows = await database.query('SELECT entity_id FROM records WHERE owner_id=$1', [
        'owner',
      ]);
      expect(rows.rows.map((row: {entity_id: string}) => row.entity_id)).toEqual([seed.id]);
    } finally {
      await peer.close();
    }
  } finally {
    await database.end();
  }
});
