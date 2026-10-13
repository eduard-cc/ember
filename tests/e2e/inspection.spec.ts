import {expect, test} from '@playwright/test';

import {navigate} from '../navigation';

test('historical workouts repeat as editable uncompleted targets', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
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
  await navigate(page, 'Exercises');
  await expect(page.getByRole('heading', {name: 'Exercises', exact: true})).toBeVisible();
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).first().click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  await page.getByRole('button', {name: 'Estimated 1RM', exact: true}).click();
  await expect(page.getByText(/Epley/)).toBeVisible();
  await expect(page.getByRole('table', {name: 'Exact trend values'})).toBeVisible();
  await page.getByLabel('Time range').selectOption('all');
  await expect(page.getByRole('button', {name: /View source workout/}).first()).toBeVisible();
});

test('a single drawing renders at the same size as each drawing in a pair', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  const widths = async (name: string) => {
    await page.getByLabel('Search exercises').fill(name);
    await page.getByRole('button', {name, exact: true}).first().click();
    await page.getByRole('tab', {name: 'About', exact: true}).click();
    const drawings = page.locator('.about-drawings > .drawing');
    await expect(drawings.first()).toBeVisible();
    const boxes = await drawings.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().width),
    );
    await page.getByRole('button', {name: 'Back to exercises'}).click();
    return boxes;
  };
  const pair = await widths('Bench Press (Barbell)');
  expect(pair).toHaveLength(2);
  const single = await widths('Plank');
  expect(single).toHaveLength(1);
  expect(Math.abs(single[0] - pair[0])).toBeLessThanOrEqual(2);
});
