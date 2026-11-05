import {expect, test} from '@playwright/test';

test('the cog beside the Profile title opens Settings, also for a read-only follower', async ({
  page,
  context,
}) => {
  // The cog beside the Profile title is the phone entry to Settings.
  await page.goto('/?demo=1');
  await expect(page.getByLabel('WORKOUT NAME')).toBeEditable();
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.getByRole('alert')).toContainText('Another tab is editing');
  await follower.getByRole('button', {name: 'Minimize workout'}).click();
  await follower
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'Profile', exact: true})
    .click();
  const library = follower.locator('.library-scroll');
  const cog = library.getByRole('button', {name: 'Settings', exact: true});
  await expect(cog).toHaveCount(1);
  await expect(cog).toBeEnabled();
  // On the title row, at its right edge, without making the 32px row taller.
  const title = await library.locator('h1').boundingBox();
  const box = await cog.boundingBox();
  expect(title!.height).toBe(32);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(box!.y + box!.height / 2 - (title!.y + title!.height / 2))).toBeLessThanOrEqual(
    1,
  );
  expect(box!.x + box!.width).toBeLessThanOrEqual(follower.viewportSize()!.width);

  await cog.click();
  const settings = follower.getByRole('dialog', {name: 'Settings', exact: true});
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', {name: 'Add weight'})).toBeDisabled();
  await settings.getByRole('button', {name: 'Close settings'}).click();
  await expect(settings).toBeHidden();
});
