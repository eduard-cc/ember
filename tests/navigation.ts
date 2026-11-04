import {type Locator, type Page, expect} from '@playwright/test';

/** Browse the real library without interacting with the covered mobile sheet. */
export async function navigate(page: Page, name: 'Workouts' | 'History' | 'Exercises') {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', /^(saving|error|saved)$/);
  await expect(page.locator('main')).toBeVisible();
  // A closing drawer or animated dialog still hides the page from the accessibility tree.
  await expect(page.locator('.overlay-motion')).toHaveCount(0);
  if (await page.getByRole('dialog', {name: 'Settings', exact: true}).isVisible())
    await page.getByRole('button', {name: 'Close settings'}).click();
  if (await page.getByRole('button', {name: 'Minimize workout'}).isVisible())
    await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: name === 'Workouts' ? 'Workout' : name, exact: true})
    .click();
}

/** Select an existing catalog or recorded exercise through the library picker. */
export async function addExercise(page: Page, name: string) {
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await picker.getByLabel('Search exercises').fill(name);
  const existing = picker
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name, exact: true});
  await expect(existing).toBeVisible();
  await existing.click();
  await expect(picker).toBeHidden();
}

/**
 * Phones have no Settings button in the tab bar, so with the logger minimized they reach it
 * through the cog beside the Profile title; the desktop header and the open logger still expose
 * the button.
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
      .locator('.library-scroll')
      .getByRole('button', {name: 'Settings', exact: true})
      .click({timeout: 1000});
  }).toPass({timeout: 15000});
  await expect(page.getByRole('dialog', {name: 'Settings', exact: true})).toBeVisible();
}

/**
 * The text a sighted user reads. Rolling counts (NumberFlow) draw every digit column in their
 * shadow root, which `toHaveText` would read as "0123456789"; this reads their value instead.
 */
export function shownText(locator: Locator) {
  return locator.evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const count of clone.querySelectorAll('number-flow-react'))
      count.replaceWith(count.getAttribute('data-value') ?? '');
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/**
 * Press whatever the user sees at the centre of an element, as a finger would: unlike
 * `locator.click()`, the event goes to the topmost element at that point.
 */
export async function pressAt(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  const touch = await page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Delete one set through its set-number actions: the phone drawer's Delete set below 1000px,
 * the row's revealed Delete from 1000px.
 */
export async function deleteSet(page: Page, row: Locator) {
  await row.getByRole('button', {name: /^Actions for /}).click();
  if (page.viewportSize()!.width < 1000)
    await page
      .getByRole('menu', {name: /^Actions for /})
      .getByRole('menuitem', {name: 'Delete set'})
      .click();
  else await row.getByRole('button', {name: /^Delete /}).click();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A History card's button, named for the workout and its date ("Push day, 1 Feb 2026"). */
export const workoutCard = (page: Page, name: string) =>
  page.getByRole('button', {name: new RegExp(`^${escape(name)}, \\d`)}).first();

/** Open a History workout's drawer (a centred dialog from 1000px) from its card. */
export async function openWorkout(page: Page, name: string) {
  // A drawer that is still closing keeps the page out of the accessibility tree.
  await expect(page.locator('.overlay-motion')).toHaveCount(0);
  await workoutCard(page, name).click();
  const drawer = page.locator('.workout-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Choose Edit workout or Delete workout from an open workout drawer's ⋯ menu. */
export async function workoutAction(page: Page, name: string, action: string) {
  const drawer = await openWorkout(page, name);
  await drawer
    .getByRole('button', {name: new RegExp(`^Workout options for ${escape(name)}`)})
    .click();
  await page.getByRole('menuitem', {name: action}).click();
  await expect(drawer).toBeHidden();
}

/** Choose Edit template or Delete template from a template card's ⋯ menu (the first card's without a name). */
export async function templateAction(page: Page, action: string, name?: string) {
  await page
    .getByRole('button', {
      name: name ? `Template options for ${name}` : /^Template options for /,
      exact: !!name,
    })
    .first()
    .click();
  await page.getByRole('menuitem', {name: action}).click();
  // On phones the action runs once the menu's drawer has gone.
  if (action === 'Edit template') await expect(page.locator('.template-editor')).toBeVisible();
  else await expect(page.getByRole('dialog', {name: 'Delete this template?'})).toBeVisible();
}

/** Close the finish celebration with Done, onto History. */
export async function closeCelebration(page: Page) {
  const celebration = page.getByRole('dialog', {name: 'Workout complete'});
  await celebration.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(celebration).toBeHidden();
}
