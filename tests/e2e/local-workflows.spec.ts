import {expect, test} from '@playwright/test';

const csv =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration\n2026-01-10 12:00:00;Synthetic import;Synthetic Press;1;30;kg;8;;40m';
test('templates can be created edited started and deleted', async ({page}) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'Templates', exact: true}).click();
  await page.getByRole('button', {name: 'Create template'}).click();
  await page.getByLabel('Template name').fill('My test session');
  await page.getByLabel('Exercise name').fill('Custom Press');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My test session'})).toBeVisible();
  await page.getByRole('button', {name: 'Edit template My test session', exact: true}).click();
  await page.getByLabel('Template name').fill('Edited session');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await page.getByRole('button', {name: 'Start template Edited session', exact: true}).click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByLabel('workout name', {exact: false})).toHaveValue('Edited session');
  await page.getByRole('button', {name: 'Templates', exact: true}).click();
  await page.getByRole('button', {name: 'Delete template Edited session'}).click();
  await page.getByRole('button', {name: 'Confirm delete template'}).click();
  await expect(page.getByRole('heading', {name: 'Edited session'})).toHaveCount(0);
});
test('CSV previews require explicit replacement and malformed files preserve history', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'Import CSV'}).click();
  await page
    .getByLabel('Choose CSV file')
    .setInputFiles({name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)});
  await expect(page.getByText('1 workout · 1 set · 1 exercise')).toBeVisible();
  await expect(page.getByText('Demo data', {exact: true}).first()).toBeVisible();
  await page.getByRole('button', {name: 'Replace history', exact: true}).click();
  await expect(page.getByText('Strong CSV', {exact: true}).first()).toBeVisible();
  await page.getByRole('button', {name: 'Import CSV'}).click();
  await page.getByLabel('Choose CSV file').setInputFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('not,a,strong,export'),
  });
  await expect(page.getByRole('alert')).toContainText('not a supported Strong export');
  await page.getByRole('button', {name: 'Close import'}).click();
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Synthetic import'})).toBeVisible();
});
test('a failed template commit never announces that it was saved', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'History', exact: true}).click();
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
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
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
  await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue(
    'Unsaved edit '.repeat(10000),
  );
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue('Upper body A');
});
test('invalid numbers cannot be completed and edits clear previous completion', async ({page}) => {
  await page.goto('/?demo=1');
  const reps = page.getByLabel(/Reps for .* set 1/).first();
  const complete = page.getByRole('button', {name: /Complete .* set 1/}).first();
  await reps.fill('3.5');
  await expect(complete).toBeDisabled();
  await reps.fill('8');
  await complete.click();
  await reps.fill('1001');
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
});
