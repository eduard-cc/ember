import {expect, test} from '@playwright/test';

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
    await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    await page.getByRole('button', {name: 'Reset unreadable saved data', exact: true}).click();
    const confirmation = page.getByRole('dialog', {
      name: 'Reset unreadable saved data?',
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', {name: 'Keep saved data'}).click();
    await expect(confirmation).toBeHidden();
    await expect(
      page.getByRole('button', {name: 'Reset unreadable saved data', exact: true}),
    ).toBeFocused();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'error');
    expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
    await page.getByRole('button', {name: 'Reset unreadable saved data', exact: true}).click();
    await confirmation.getByRole('button', {name: 'Reset saved data', exact: true}).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
    expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeEnabled();
  });
}
