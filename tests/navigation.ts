import {type Page, expect} from '@playwright/test';

/** Browse the real library without interacting with the covered mobile sheet. */
export async function navigate(page: Page, name: 'Workouts' | 'History' | 'Exercises') {
  await expect(page.locator('main .saved-status')).toHaveText(
    /^(Saving…|Not saved|Saved on this device)$/,
  );
  if (await page.getByRole('dialog', {name: 'Settings', exact: true}).isVisible())
    await page.getByRole('button', {name: 'Close settings'}).click();
  if (await page.getByRole('button', {name: 'Minimize workout'}).isVisible())
    await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name, exact: true})
    .click();
}

export async function openSettings(page: Page) {
  if (!(await page.getByRole('dialog', {name: 'Settings', exact: true}).isVisible()))
    await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
}

export async function openImport(page: Page) {
  await openSettings(page);
  if (!(await page.getByLabel('Choose CSV file').isVisible()))
    await page.getByRole('button', {name: 'Import CSV', exact: true}).click();
}
