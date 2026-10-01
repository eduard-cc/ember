import {expect, test} from '@playwright/test';

test('historical workouts repeat as editable uncompleted targets', async ({page}) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Workout history'})).toBeVisible();
  await page
    .getByRole('button', {name: /Repeat workout/})
    .first()
    .click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByRole('heading', {name: 'Your workout'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
  await expect(page.getByRole('button', {name: /Complete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
test('progress exposes source sets and selectable metrics', async ({page}) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'Progress', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Exercise progress'})).toBeVisible();
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Estimated 1RM', exact: true}).click();
  await expect(page.getByText(/Epley/)).toBeVisible();
  await expect(page.getByRole('table', {name: 'Exact trend values'})).toBeVisible();
  await page.getByLabel('Time range').selectOption('all');
  await expect(page.getByRole('button', {name: /View source workout/}).first()).toBeVisible();
});
