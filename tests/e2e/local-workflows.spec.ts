import {expect, test} from '@playwright/test';

import {addExercise, navigate, openImport} from '../navigation';

const csv =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration\n2026-01-10 12:00:00;Synthetic import;Synthetic Press;1;30;kg;8;;40m';
test('templates can be created edited started and deleted', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template'}).click();
  await page.getByLabel('Template name').fill('My test session');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My test session'})).toBeVisible();
  const card = page.locator('.template-card', {hasText: 'My test session'});
  await expect(card.locator('.template-open li')).toHaveText(['3 × Bench Press (Barbell)']);
  await page.getByRole('button', {name: 'Edit template My test session', exact: true}).click();
  await page.getByLabel('Template name').fill('Edited session');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await page.getByRole('button', {name: 'Open template Edited session', exact: true}).click();
  await page.getByRole('button', {name: 'Start template Edited session', exact: true}).click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByLabel('workout name', {exact: false})).toHaveValue('Edited session');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Delete template Edited session'}).click();
  await page.getByRole('button', {name: 'Confirm delete template'}).click();
  await expect(page.getByRole('heading', {name: 'Edited session'})).toHaveCount(0);
});
test('CSV previews require explicit replacement and malformed files preserve history', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await openImport(page);
  await page
    .getByLabel('Choose CSV file')
    .setInputFiles({name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)});
  await expect(page.getByText('1 workout · 1 set · 1 exercise')).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const path = '/src/storage/repository.ts';
      const {WorkoutRepository} = await import(path);
      const repository = new WorkoutRepository();
      try {
        return (await repository.readState()).dataset?.sourceLabel;
      } finally {
        repository.close();
      }
    }),
  ).toBe('Demo data');
  await page.getByRole('button', {name: 'Replace history', exact: true}).click();
  await expect(
    page
      .getByRole('dialog', {name: 'Settings'})
      .getByText('History replaced. Your draft and finished workouts were kept.', {exact: true}),
  ).toBeVisible();
  // Replacing closes the panel and leaves focus on the toggle, not on the dialog.
  await expect(page.locator('.import-panel')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Import CSV', exact: true})).toBeFocused();
  await openImport(page);
  await page.getByLabel('Choose CSV file').setInputFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('not,a,strong,export'),
  });
  await expect(page.getByRole('alert')).toContainText('not a supported Strong export');
  await page.getByRole('button', {name: 'Close import'}).click();
  // Close import removes the panel, flips the toggle back and keeps focus on it.
  await expect(page.locator('.import-panel')).toHaveCount(0);
  const toggle = page.getByRole('button', {name: 'Import CSV', exact: true});
  await expect(toggle).toBeVisible();
  await expect(page.getByRole('button', {name: 'Close import'})).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await page.getByRole('button', {name: 'Close settings'}).click();
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'Synthetic import'})).toBeVisible();
});
test('a failed template commit never announces that it was saved', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'History');
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'templates')
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.getByRole('button', {name: 'Save as template'}).first().click();
  await expect(page.getByRole('alert')).toContainText('Could not save on this device');
  await expect(page.getByText('Workout saved as an editable template.', {exact: true})).toHaveCount(
    0,
  );
});
test('IndexedDB quota-error injection retains memory and never reports saved', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // Chromium's incognito IDB backend ignores CDP quota overrides. Inject the
  // platform error at the real IDB write boundary; hydration/happy path are real.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts')
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByLabel('WORKOUT NAME', {exact: true}).fill('Unsaved edit '.repeat(10000));
  await expect(page.getByRole('alert')).toContainText('Could not save on this device');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'error');
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue(
    'Unsaved edit '.repeat(10000),
  );
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue('Upper body A');
});
test('invalid numbers cannot be completed and untick a completed set', async ({page}) => {
  await page.goto('/?demo=1');
  const card = page.locator('.exercise-card').first();
  const reps = card.getByLabel(/Reps for .* set 1$/);
  // Named "Complete …" or "Uncomplete …" depending on state.
  const complete = card.getByRole('button', {name: /complete .* set 1$/i});
  await reps.fill('3.5');
  await expect(complete).toBeDisabled();
  await reps.fill('8');
  await complete.click();
  await expect(complete).toHaveAttribute('aria-pressed', 'true');
  await reps.fill('1001');
  await expect(complete).toHaveAttribute('aria-pressed', 'false');
  await expect(complete).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
});
