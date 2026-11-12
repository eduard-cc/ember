import {expect, test} from '@playwright/test';

import type {Workout} from '../../src/domain/types';
import {navigate, openWorkout, workoutAction} from '../navigation';
import {login, syncNow} from './helpers';

const workout: Workout = {
  id: 'history-edit-' + crypto.randomUUID(),
  name: 'Synthetic session',
  date: '2026-01-01T12:00:00',
  duration: 30,
  exercises: [
    {
      name: 'Synthetic Press',
      type: 'weighted',
      sets: [{id: 'press-1', weight: 40, reps: 8, seconds: null, distance: null, completed: true}],
    },
  ],
};

test('history edits and deletion reach a second device through the real API', async ({
  page,
  browser,
}) => {
  await page.addInitScript((finished) => {
    localStorage.setItem(
      'ember:v1',
      JSON.stringify({
        version: 1,
        dataset: null,
        active: null,
        finished: [finished],
        templates: [],
      }),
    );
  }, workout);
  await login(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  const peer = await browser.newContext();
  try {
    const fresh = await peer.newPage();
    await login(fresh);
    await navigate(fresh, 'History');
    await expect(fresh.getByRole('heading', {name: workout.name, exact: true})).toBeVisible();

    await navigate(page, 'History');
    await workoutAction(page, 'Synthetic session', 'Edit workout');
    const editor = page.getByRole('dialog', {name: 'Edit workout'});
    await editor.getByLabel('Workout name').fill('Corrected session');
    await editor.getByLabel('Duration (min)').fill('45');
    await editor.getByLabel('Reps for Synthetic Press set 1').fill('10');
    await editor.getByRole('button', {name: 'Save changes'}).click();
    await expect(editor).toBeHidden();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
    await syncNow(fresh);
    await expect(
      fresh.getByRole('heading', {name: 'Corrected session', exact: true}),
    ).toBeVisible();
    await expect(fresh.locator('.history-card')).toContainText('45 min');
    const drawer = await openWorkout(fresh, 'Corrected session');
    await expect(drawer.locator('.recorded-sets')).toContainText('40 kg × 10');

    await workoutAction(page, 'Corrected session', 'Delete workout');
    const confirmation = page.getByRole('dialog', {name: 'Delete this workout?'});
    await confirmation.getByRole('button', {name: 'Delete workout'}).click();
    await expect(confirmation).toBeHidden();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
    await syncNow(fresh);
    await expect(fresh.locator('.history-card')).toHaveCount(0);
    await fresh.reload();
    await expect(fresh.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
    await navigate(fresh, 'History');
    await expect(fresh.locator('.history-card')).toHaveCount(0);
  } finally {
    await peer.close();
  }
});
