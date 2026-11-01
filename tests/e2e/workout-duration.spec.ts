import {devices, expect, test} from '@playwright/test';

import {addExercise, closeCelebration} from '../navigation';

test.use({...devices['Pixel 6']});

test('finishing saves elapsed minutes in history on Pixel 6', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Pixel 6 flow');
  await page.clock.install({time: new Date('2026-01-10T12:00:00')});
  await page.goto('/');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await page.getByLabel('WORKOUT NAME', {exact: true}).fill('Synthetic timed workout');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.getByLabel('Weight for Bench Press (Barbell) set 1').fill('30');
  await page.getByLabel('Reps for Bench Press (Barbell) set 1').fill('8');
  await page.clock.fastForward(45 * 60 * 1000);
  await page.getByRole('button', {name: 'Complete Bench Press (Barbell) set 1'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Finish workout'}).click();
  await page.getByRole('button', {name: 'Save finished workout'}).click();
  await closeCelebration(page);
  const card = page.locator('.history-card', {hasText: 'Synthetic timed workout'});
  await expect(card).toContainText('45 min');
  await expect(card.locator('.exercise-line')).toContainText('30 kg × 8');
  await page.reload();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'History', exact: true})
    .click();
  await expect(card).toContainText('45 min');
});

test('a workout finished within a minute shows under one minute on Pixel 6', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Pixel 6 flow');
  await page.clock.install({time: new Date('2026-01-10T12:00:00')});
  await page.goto('/');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await page.getByLabel('WORKOUT NAME', {exact: true}).fill('Synthetic quick workout');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.getByLabel('Weight for Bench Press (Barbell) set 1').fill('30');
  await page.getByLabel('Reps for Bench Press (Barbell) set 1').fill('8');
  await page.clock.fastForward(30 * 1000);
  await page.getByRole('button', {name: 'Complete Bench Press (Barbell) set 1'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Finish workout'}).click();
  await page.getByRole('button', {name: 'Save finished workout'}).click();
  await closeCelebration(page);
  const card = page.locator('.history-card', {hasText: 'Synthetic quick workout'});
  await expect(card).toContainText('<1 min');
  await page.reload();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'History', exact: true})
    .click();
  await expect(card).toContainText('<1 min');
});
