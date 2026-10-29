import {expect, test} from '@playwright/test';

import {addExercise, navigate} from '../navigation';

test('empty workouts accept an exercise with duration units and completed sets', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout', exact: true}).click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await addExercise(page, 'Plank');
  await expect(page.getByLabel('Seconds for Plank set 1')).toBeVisible();
  await expect(page.getByLabel('Distance in km for Plank set 1')).toHaveCount(0);
  await page.getByLabel('Seconds for Plank set 1').fill('90');
  await page.getByRole('button', {name: 'Complete Plank set 1', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeEnabled();
});
test('assistance progress excludes resistance estimates and source link opens sets', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Exercises');
  await page.getByLabel('Search exercises').fill('Assisted');
  await page.getByRole('button', {name: 'Pull Up (Assisted)', exact: true}).click();
  await page.getByRole('tab', {name: 'Charts', exact: true}).click();
  await page.getByRole('button', {name: 'Assistance (less is better)', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Estimated 1RM', exact: true})).toHaveCount(0);
  await page
    .getByRole('button', {name: /View source workout/})
    .first()
    .click();
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await expect(page.getByText(/Set 1:.*assistance/).first()).toBeVisible();
});
test('all navigation screens fit their viewport without horizontal overflow', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?demo=1');
  await page.screenshot({path: testInfo.outputPath('workout.png')});
  for (const view of ['Workouts', 'Exercises', 'History'] as const) {
    await navigate(page, view);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (view === 'Exercises')
      await page.screenshot({
        path: testInfo.outputPath('exercises.png'),
        fullPage: false,
      });
  }
  expect(errors).toEqual([]);
});
