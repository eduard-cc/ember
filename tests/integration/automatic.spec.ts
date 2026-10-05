import {type Page, expect, test} from '@playwright/test';
import {createRequire} from 'node:module';

import {demoTemplates} from '../../src/domain/demo';

const template = {...demoTemplates[0], id: 'automatic-template', name: 'Automatic template'};
const finished = {
  ...template,
  id: 'automatic-history',
  name: 'Automatic history',
  date: '2026-01-01T12:00:00',
  exercises: template.exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({...set, completed: true})),
  })),
};
const draft = {...template, id: 'automatic-draft', name: 'Device-only draft'};
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      return {
        state: await repository.readState(),
        pending: await repository.db.outbox.toArray(),
        owner: (await repository.db.meta.get('ownerId'))?.value,
      };
    } finally {
      repository.close();
    }
  });
}

test('fresh Tailscale devices automatically connect completed history and templates without repeated bootstrap', async ({
  page,
  browser,
}) => {
  await page.addInitScript(
    (state) => {
      if (!localStorage.getItem('seeded')) {
        localStorage.setItem('gym-log:v1', JSON.stringify(state));
        localStorage.setItem('seeded', 'yes');
      }
    },
    {version: 1, dataset: null, finished: [finished], templates: [template], active: draft},
  );
  let bootstraps = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/session') && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({});
      expect(request.headers()['tailscale-user-login']).toBeUndefined();
      bootstraps++;
    }
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  expect((await snapshot(page)).pending).toEqual([]);
  await expect(page.getByLabel('Server password')).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    const pulled = page.waitForResponse('**/api/v1/sync/changes?*');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await pulled;
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  }
  expect(bootstraps).toBe(1);
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await peer.goto('/');
  await expect(peer.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  const remote = await snapshot(peer);
  expect(remote.owner).toBe('owner');
  expect(remote.state.finished).toEqual([finished]);
  expect(remote.state.templates).toEqual([template]);
  expect(remote.state.active).toBeNull();
  await peer.getByRole('button', {name: 'History', exact: true}).click();
  await expect(peer.getByText('Automatic history', {exact: true}).first()).toBeVisible();
  await peerContext.close();
});

test('Tailscale reconnect automatically renews an expired session and sends offline finish while keeping the draft local', async ({
  page,
  context,
  browser,
}) => {
  await page.addInitScript((active) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem(
        'gym-log:v1',
        JSON.stringify({version: 1, dataset: null, finished: [], templates: [], active}),
      );
      localStorage.setItem('seeded', 'yes');
    }
  }, draft);
  let bootstraps = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/session') && request.method() === 'POST') bootstraps++;
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  const url = new URL(process.env.GYM_LOG_TEST_DATABASE_URL!);
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    !/^\/gym_log_browser_test_\d+_\d+$/.test(url.pathname)
  )
    throw new Error('Session expiry fixture requires a disposable browser-test database');
  const require = createRequire(new URL('../../server/package.json', import.meta.url));
  const {Pool} = require('pg');
  const database = new Pool({connectionString: url.toString()});
  try {
    const expired = await database.query(
      "UPDATE sessions SET expires_at=now() - interval '1 second'",
    );
    expect(expired.rowCount).toBe(1);
    const active = await database.query('SELECT count(*) FROM sessions WHERE expires_at>now()');
    expect(Number(active.rows[0].count)).toBe(0);
  } finally {
    await database.end();
  }
  expect(await page.evaluate(async () => (await fetch('/api/v1/session')).status)).toBe(401);
  await context.setOffline(true);
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await page.getByRole('button', {name: 'Finish workout', exact: true}).click();
  await page.getByRole('button', {name: 'Save finished workout', exact: true}).click();
  await expect.poll(async () => (await snapshot(page)).pending.length).toBe(1);
  const local = await snapshot(page);
  expect(local.state.finished).toHaveLength(1);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await expect.poll(async () => (await snapshot(page)).pending.length).toBe(0);
  expect(bootstraps).toBe(2);
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await peer.goto('/');
  await expect(peer.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  const remote = await snapshot(peer);
  expect(remote.state.finished).toEqual(local.state.finished);
  expect(remote.state.active).toBeNull();
  await peerContext.close();
});
