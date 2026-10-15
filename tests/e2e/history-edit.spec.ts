import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

// Synthetic fixture only.
const set = (id: string, weight: number, reps: number) => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
});
const seeded = {
  version: 1,
  dataset: {
    sourceLabel: 'Synthetic fixture',
    workouts: [
      {
        id: 'later',
        name: 'Push day',
        date: '2026-02-01T12:00:00',
        duration: 40,
        exercises: [{name: 'Synthetic Press', type: 'weighted', sets: [set('p1', 50, 5)]}],
      },
      {
        id: 'earlier',
        name: 'Pull day',
        date: '2026-01-01T12:00:00',
        duration: 35,
        exercises: [{name: 'Synthetic Row', type: 'weighted', sets: [set('r1', 30, 10)]}],
      },
    ],
    warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [],
};

const open = async (page: Page, value = seeded) => {
  await page.addInitScript(
    (value) => localStorage.setItem('gym-log:v1', JSON.stringify(value)),
    value,
  );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'History');
};
const menu = (page: Page, name: string) =>
  page.getByRole('button', {name: new RegExp(`Workout options for ${name}`)});

test('a history workout can be edited and the edit survives a reload', async ({page}) => {
  await open(page);
  await menu(page, 'Push day').click();
  await page.getByRole('menuitem', {name: 'Edit workout'}).click();
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await expect(editor.getByRole('button', {name: 'Save changes'})).toBeDisabled();
  await editor.getByLabel('Workout name').fill('Heavy push');
  await editor.getByLabel('Duration (min)').fill('55');
  await editor.getByLabel('Reps for Synthetic Press set 1').fill('6');
  // Clearing a value blocks saving with a reason instead of storing a broken set.
  await editor.getByLabel('Weight for Synthetic Press set 1').fill('');
  await expect(editor.getByRole('alert')).toContainText('Fill in the new or changed set');
  await expect(editor.getByRole('button', {name: 'Save changes'})).toBeDisabled();
  await editor.getByLabel('Weight for Synthetic Press set 1').fill('52.5');
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor).toBeHidden();
  await expect(menu(page, 'Heavy push')).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

  await page.reload();
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'Heavy push'})).toBeVisible();
  await page
    .getByRole('button', {name: /View sets for Heavy push/})
    .first()
    .click();
  await expect(page.locator('.workout-details').first()).toContainText('52.5 kg × 6');
  await expect(page.locator('.history-card').first()).toContainText('55');
});

test('cancelling an edited workout asks before discarding', async ({page}) => {
  await open(page);
  await menu(page, 'Pull day').click();
  await page.getByRole('menuitem', {name: 'Edit workout'}).click();
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await editor.getByLabel('Workout name').fill('Changed');
  await page.keyboard.press('Escape');
  await expect(editor.getByText('Discard your changes to this workout?')).toBeVisible();
  await editor.getByRole('button', {name: 'Keep editing'}).click();
  await expect(editor.getByLabel('Workout name')).toHaveValue('Changed');
  await editor.getByRole('button', {name: 'Cancel'}).click();
  await editor.getByRole('button', {name: 'Discard changes'}).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toBeVisible();
});

for (const dismissal of ['close button', 'Escape']) {
  test(`${dismissal} brings a long workout's discard prompt into view and focuses it`, async ({
    page,
  }) => {
    const long = structuredClone(seeded);
    long.dataset.workouts[0].exercises = Array.from({length: 8}, (_, i) => ({
      name: `Synthetic exercise ${i + 1}`,
      type: 'weighted',
      sets: Array.from({length: 4}, (_, j) => set(`long-${i}-${j}`, 40, 8)),
    }));
    await open(page, long);
    await menu(page, 'Push day').click();
    await page.getByRole('menuitem', {name: 'Edit workout'}).click();
    const editor = page.getByRole('dialog', {name: 'Edit workout'});
    await editor.getByLabel('Workout name').fill('Unsaved name');
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await editor.getByRole('button', {name: 'Close workout editor'}).click();
    const prompt = editor.getByRole('group', {name: 'Discard changes?'});
    await expect(prompt).toBeInViewport({ratio: 1});
    await expect(prompt).toBeFocused();
    // The keyboard lands on the safe option first, and cancelling retains the draft.
    await page.keyboard.press('Tab');
    await expect(prompt.getByRole('button', {name: 'Keep editing'})).toBeFocused();
    // Scroll away without answering, then dismiss again. The existing prompt must be
    // revealed and focused again, not only on its first mount.
    await editor.getByLabel('Workout name').focus();
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await editor.getByRole('button', {name: 'Close workout editor'}).click();
    await expect(prompt).toBeInViewport({ratio: 1});
    await expect(prompt).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(prompt.getByRole('button', {name: 'Keep editing'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prompt).toBeHidden();
    await expect(editor.getByLabel('Workout name')).toHaveValue('Unsaved name');
    await editor.getByRole('button', {name: 'Close workout editor'}).click();
    await prompt.getByRole('button', {name: 'Discard changes'}).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('heading', {name: 'Push day'})).toBeVisible();
  });
}

test('a history workout can be deleted after confirmation', async ({page}) => {
  await open(page);
  await menu(page, 'Pull day').click();
  await page.getByRole('menuitem', {name: 'Delete workout'}).click();
  const confirm = page.getByRole('dialog', {name: 'Delete this workout?'});
  await expect(confirm).toContainText('Pull day on 1 Jan 2026 and its 1 set');
  await confirm.getByRole('button', {name: 'Keep workout'}).click();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toBeVisible();

  await menu(page, 'Pull day').click();
  await page.getByRole('menuitem', {name: 'Delete workout'}).click();
  await confirm.getByRole('button', {name: 'Delete workout'}).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

  await page.reload();
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'Push day'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toHaveCount(0);
});
