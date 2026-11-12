import {expect, test} from '@playwright/test';

import {navigate} from '../navigation';

for (const raw of ['{broken-json', JSON.stringify({version: 2, finished: []})]) {
  test(`unreadable saved state is preserved: ${raw}`, async ({page}) => {
    await page.addInitScript((value) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('ember:v1', value);
        sessionStorage.setItem('seeded', 'yes');
      }
    }, raw);
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'error');
    await navigate(page, 'Workouts');
    await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    // The problem strip opens its details, which hold the reset.
    await page.getByRole('button', {name: /^Saved data can’t be read/}).click();
    const details = page.getByRole('dialog', {name: 'Saved data unavailable', exact: true});
    await expect(details).toContainText('The original has been left untouched.');
    await details.getByRole('button', {name: 'Reset unreadable saved data', exact: true}).click();
    const confirmation = page.getByRole('dialog', {
      name: 'Reset unreadable saved data?',
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', {name: 'Keep saved data'}).click();
    await expect(confirmation).toBeHidden();
    await expect(
      details.getByRole('button', {name: 'Reset unreadable saved data', exact: true}),
    ).toBeFocused();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'error');
    expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
    await details.getByRole('button', {name: 'Reset unreadable saved data', exact: true}).click();
    await confirmation.getByRole('button', {name: 'Reset saved data', exact: true}).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
    await expect(details).toBeHidden();
    await expect(page.locator('.status-strip')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await navigate(page, 'Workouts');
    await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeEnabled();
  });
}
