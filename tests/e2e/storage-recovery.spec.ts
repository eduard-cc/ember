import {expect, test} from '@playwright/test';

for (const raw of ['{broken-json', JSON.stringify({version: 2, finished: []})]) {
  test(`unreadable saved state is preserved: ${raw}`, async ({page}) => {
    await page.addInitScript((value) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('gym-log:v1', value);
        sessionStorage.setItem('seeded', 'yes');
      }
    }, raw);
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('gym-log:v1'))).toBe(raw);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', {name: 'Reset unreadable saved data'}).click();
    await expect(page.getByText('Not saved', {exact: true})).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', {name: 'Reset unreadable saved data'}).click();
    await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('gym-log:v1'))).toBe(raw);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeEnabled();
  });
}
