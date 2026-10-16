import {expect, test} from '@playwright/test';

test('Profile links only to Settings', async ({page}, info) => {
  // The Settings row is the phone entry point; desktop uses the header gear (see app-shell).
  test.skip(info.project.name !== 'mobile');
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // The demo opens its active workout; minimize it to reach the library on phones.
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'Profile', exact: true})
    .click();
  const links = page.getByRole('navigation', {name: 'Profile'}).getByRole('button');
  await expect(links).toHaveText(['Settings']);
  await links.click();
  await expect(page.getByRole('dialog', {name: 'Settings', exact: true})).toBeVisible();
});
