import { test, expect } from '@playwright/test';

for (const raw of ['{broken-json', JSON.stringify({ version: 2, finished: [] })]) {
  test(`unreadable saved state is preserved: ${raw}`, async ({ page }) => {
    await page.addInitScript(value => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('gym-log:v1', value);
        sessionStorage.setItem('seeded', 'yes');
      }
    }, raw);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your workout' })).toBeVisible();
    // Check the storage boundary after the initial persistence effect has run.
    expect(await page.evaluate(() => localStorage.getItem('gym-log:v1'))).toBe(raw);
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
    await page.getByLabel(/Reps for .* set 1/).first().fill('9');
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Saved data could not be read');
    expect(await page.evaluate(() => localStorage.getItem('gym-log:v1'))).toBe(raw);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Reset unreadable saved data' }).click();
    expect(await page.evaluate(() => localStorage.getItem('gym-log:v1'))).toBe(raw);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset unreadable saved data' }).click();
    await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gym-log:v1')!).version)).toBe(1);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
