import {expect, test} from '@playwright/test';

test('downloads versioned backup and previews file before confirmed local restore', async ({
  page,
}) => {
  await page.goto('/tests/recovery/index.html');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export local backup'}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/gym-log-backup.*json/);
  const path = await download.path();
  await page.getByLabel('Import backup JSON').setInputFiles(path);
  await expect(page.getByRole('status')).toContainText('0 historical workouts');
  await expect(page.getByRole('button', {name: 'Restore backup locally'})).toBeDisabled();
  await page.getByLabel('I understand this replaces local data and resets draft ownership').check();
  await page.getByRole('button', {name: 'Restore backup locally'}).click();
  await expect(page.getByRole('status')).toContainText('Restored locally');
  await expect(page.locator('body')).toHaveAttribute('data-restored', 'true');
});
test('committed restore reports refresh failure honestly without calling it a failed restore', async ({
  page,
}) => {
  await page.goto('/tests/recovery/index.html?refreshFailure');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export local backup'}).click();
  const download = await downloadPromise;
  await page.getByLabel('Import backup JSON').setInputFiles(await download.path());
  await page.getByLabel('I understand this replaces local data and resets draft ownership').check();
  await page.getByRole('button', {name: 'Restore backup locally'}).click();
  await expect(page.getByRole('alert')).toContainText(
    'Restore completed, but the view could not refresh',
  );
});
test('invalid backup leaves restore unavailable and exposes an accessible error', async ({
  page,
}) => {
  await page.goto('/tests/recovery/index.html');
  await page.getByLabel('Import backup JSON').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid backup');
  await expect(page.getByRole('button', {name: 'Restore backup locally'})).toBeDisabled();
});
