import {expect, test} from '@playwright/test';

test('explicit set completion persists targets and finishes only completed sets', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', {name: 'Your workout'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  await weight.fill('42.5');
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(weight).toHaveValue('42.5');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Finish workout'}).click();
  await expect(page.getByRole('dialog')).toContainText('uncompleted sets will be excluded');
  await page.getByRole('button', {name: 'Save finished workout'}).click();
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await expect(page.getByText('1 completed set', {exact: true}).first()).toBeVisible();
});
