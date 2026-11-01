import {expect, test} from '@playwright/test';

import {shownText} from '../navigation';

test('explicit set completion persists targets, finishes only completed sets and celebrates the records', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', {name: 'Your workout'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
  // Heavier than any bench set in the synthetic demo history (65 kg at most), so it is a record.
  const weight = page.getByLabel('Weight for Bench Press (Barbell) set 1');
  await weight.fill('70');
  await page.getByRole('button', {name: 'Complete Bench Press (Barbell) set 1'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(weight).toHaveValue('70');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Finish workout'}).click();
  await expect(page.getByRole('dialog')).toContainText('uncompleted sets will be excluded');
  await page.getByRole('button', {name: 'Save finished workout'}).click();

  const celebration = page.getByRole('dialog', {name: 'Workout complete'});
  await expect(celebration).toBeVisible();
  await expect(celebration).toContainText('Upper body A');
  await expect(celebration.getByRole('button', {name: 'Done'})).toBeFocused();
  // Duration, sets and volume count up to the saved workout's values.
  const stat = (label: string) => shownText(celebration.locator(`[data-stat="${label}"]`));
  await expect.poll(() => stat('Duration')).toBe('<1min');
  await expect.poll(() => stat('Sets')).toBe('1');
  await expect.poll(() => stat('Volume')).toBe('560kg');
  const records = celebration.getByRole('region', {name: 'New personal records'});
  const record = records.getByRole('listitem');
  await expect(record).toHaveCount(1);
  await expect(record).toContainText('Bench Press (Barbell)');
  await expect(record).toContainText('Heaviest weight · Est. 1RM (Epley)');
  await expect(record).toContainText('70 kg+5 kg');
  const exercises = celebration.getByRole('region', {name: 'Exercises'}).getByRole('listitem');
  await expect(exercises).toHaveCount(1);
  await expect(exercises).toContainText('70 kg × 8');
  await expect(exercises).toContainText('1 set');

  // Back is Done: it closes the celebration onto History and stays in the app.
  const url = page.url();
  await page.evaluate(() => history.back());
  await expect(celebration).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  // The new workout tops History with its records counted and its top set beside a trophy.
  const card = page.locator('.history-card').first();
  await expect(card).toContainText('Upper body A');
  await expect(card).toContainText('2 PRs');
  const line = card.locator('.exercise-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('Bench Press (Barbell)');
  await expect(line.getByRole('img', {name: 'Personal record'})).toBeVisible();
  await expect(line.locator('p').nth(2)).toHaveText('70 kg × 8');
  await expect(line.locator('p').nth(3)).toHaveText('1 set');
  await expect(page.locator('.focused-history').getByRole('button').first()).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => (history.state as {emberBackDepth?: number} | null)?.emberBackDepth ?? 0),
    )
    .toBe(0);
});
