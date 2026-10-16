import {type Page, expect} from '@playwright/test';

/** Browse the real library without interacting with the covered mobile sheet. */
export async function navigate(page: Page, name: 'Workouts' | 'History' | 'Exercises') {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', /^(saving|error|saved)$/);
  await expect(page.locator('main')).toBeVisible();
  if (await page.getByRole('dialog', {name: 'Settings', exact: true}).isVisible())
    await page.getByRole('button', {name: 'Close settings'}).click();
  if (await page.getByRole('button', {name: 'Minimize workout'}).isVisible())
    await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: name === 'Workouts' ? 'Workout' : name, exact: true})
    .click();
}

/** Add an exercise through the picker; unknown names are created with the given type. */
export async function addExercise(page: Page, name: string, type = 'Weighted') {
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await picker.getByLabel('Search exercises').fill(name);
  const create = picker.getByRole('button', {name: `Create "${name}"`, exact: true});
  const existing = picker
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name, exact: true});
  await expect(create.or(existing)).toBeVisible();
  if (await create.isVisible()) {
    await create.click();
    await picker
      .getByRole('group', {name: 'Exercise type'})
      .getByRole('button', {name: type, exact: true})
      .click();
  } else await existing.click();
  await expect(picker).toBeHidden();
}

/**
 * Phones have no Settings button in the tab bar, so with the logger minimized they reach it
 * through the Profile page; the desktop header and the open logger still expose the button.
 */
export async function openSettings(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', /^(saved|error)$/);
  const phone = (page.viewportSize()?.width ?? 1440) < 1000;
  // The logger sheet mounts after the first save status and then makes the phone library inert, so
  // decide and click together and retry the decision when the layout moved under the click.
  await expect(async () => {
    if (await page.getByRole('dialog', {name: 'Settings', exact: true}).isVisible()) return;
    const sheetOpen = await page.getByRole('region', {name: 'Active workout'}).isVisible();
    const locked = await page.locator('main').isHidden();
    if (!phone || sheetOpen || locked) {
      await page.getByRole('button', {name: 'Settings', exact: true}).last().click({timeout: 1000});
      return;
    }
    await page
      .getByRole('navigation', {name: 'Main navigation'})
      .getByRole('button', {name: 'Profile', exact: true})
      .click({timeout: 1000});
    await page
      .getByRole('navigation', {name: 'Profile'})
      .getByRole('button', {name: 'Settings', exact: true})
      .click({timeout: 1000});
  }).toPass({timeout: 15000});
  await expect(page.getByRole('dialog', {name: 'Settings', exact: true})).toBeVisible();
}

export async function openImport(page: Page) {
  await openSettings(page);
  if (!(await page.getByLabel('Choose CSV file').isVisible()))
    await page.getByRole('button', {name: 'Import CSV', exact: true}).click();
}
