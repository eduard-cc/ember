import { test, expect } from '@playwright/test';
test('empty workouts accept an exercise with duration units and completed sets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start empty', exact: true }).click();
  await page.getByRole('button', { name: 'Replace active draft' }).click();
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await page.getByLabel('Exercise name').fill('Plank');
  await page.getByLabel('Exercise type').selectOption('duration');
  await page.getByRole('button', { name: 'Add to workout' }).click();
  await expect(page.getByLabel('Seconds for Plank set 1')).toBeVisible();
  await expect(page.getByLabel('Distance in km for Plank set 1')).toHaveCount(0);
  await page.getByLabel('Seconds for Plank set 1').fill('90');
  await page.getByRole('button', { name: 'Complete Plank set 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish workout' })).toBeEnabled();
});
test('assistance progress excludes resistance estimates and source link opens sets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await page.getByLabel('Search exercises').fill('Assisted');
  await page.getByRole('button', { name: 'Pull Up (Assisted)', exact: true }).click();
  await page.getByRole('button', { name: 'Assistance (less is better)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Estimated 1RM', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /View source workout/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Workout history' })).toBeVisible();
  await expect(page.getByText(/Set 1:.*assistance/).first()).toBeVisible();
});
test('all navigation screens fit their viewport without horizontal overflow', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const view of ['Workout', 'Progress', 'History', 'Templates']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (view === 'Workout') await page.screenshot({ path: `.impeccable/review/workout-${testInfo.project.name}.png`, fullPage: false });
    if (view === 'Progress') await page.screenshot({ path: `.impeccable/review/progress-${testInfo.project.name}.png`, fullPage: false });
  }
  expect(errors).toEqual([]);
});
