import {type Page, expect, test} from '@playwright/test';

import {navigate, openSettings} from '../navigation';

// Android's back gesture is the browser's Back: it closes the newest open layer and stays in the
// app; only a main tab with nothing open leaves. Synthetic demo data only.

/** Extra history entries the app currently holds for open layers. */
const depth = (page: Page) =>
  page.evaluate(() => (history.state as {emberBackDepth?: number} | null)?.emberBackDepth ?? 0);

/** Browser Back that never navigates away; fails if the app document is replaced. */
async function back(page: Page) {
  const url = page.url();
  await page.evaluate(() => history.back());
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(page.url()).toBe(url);
}

async function start(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
}

const sheet = (page: Page) => page.getByRole('region', {name: 'Active workout'});

/** Open the newest History workout's drawer, then Edit workout from its ⋯ menu. */
async function editNewestWorkout(page: Page) {
  await expect(page.locator('.overlay-motion')).toHaveCount(0);
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: /^Workout options for /}).click();
  await page.getByRole('menuitem', {name: 'Edit workout'}).click();
}

test('back closes exercise details in the library, then a main tab has nothing left to close', async ({
  page,
}) => {
  await start(page);
  await navigate(page, 'Exercises');
  await page.getByRole('button', {name: /^Bench Press \(Barbell\)/}).click();
  await expect(page.getByRole('button', {name: 'Back to exercises'})).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await back(page);
  await expect(page.getByRole('button', {name: 'Back to exercises'})).toBeHidden();
  await expect(page.getByLabel('Search exercises')).toBeVisible();
  await expect.poll(() => depth(page)).toBe(0);
  // Closing with the on-screen arrow gives the entry back too, so back then leaves the app.
  await page.getByRole('button', {name: /^Bench Press \(Barbell\)/}).click();
  await page.getByRole('button', {name: 'Back to exercises'}).click();
  await expect.poll(() => depth(page)).toBe(0);
});

test('back closes Settings, the template preview and a History workout', async ({page}) => {
  await start(page);
  await navigate(page, 'Workouts');
  await openSettings(page);
  const settings = page.getByRole('dialog', {name: 'Settings', exact: true});
  await expect(settings).toBeVisible();
  await back(page);
  await expect(settings).toBeHidden();
  // Phones reach Settings through Profile, so return to the Workout tab for the templates.
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Open template Upper body A', exact: true}).click();
  const preview = page.getByRole('dialog', {name: 'Upper body A'});
  await expect(preview).toBeVisible();
  await back(page);
  await expect(preview).toBeHidden();
  await expect.poll(() => depth(page)).toBe(0);
  await navigate(page, 'History');
  await page.locator('.history-card button').first().click();
  const drawer = page.locator('.workout-drawer');
  await expect(drawer).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await back(page);
  await expect(drawer).toBeHidden();
  await expect.poll(() => depth(page)).toBe(0);
});

test('back steps out of nested layers one at a time on the phone workout', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile', 'The workout covers the tabs only on phones.');
  await start(page);
  await expect(sheet(page)).toBeVisible();
  await page
    .getByRole('button', {name: 'Show details for Seated Row (Cable)', exact: true})
    .click();
  const details = page.getByRole('dialog', {name: 'Seated Row (Cable)', exact: true});
  await expect(details).toBeVisible();
  await expect.poll(() => depth(page)).toBe(2);
  await back(page);
  await expect(details).toBeHidden();
  await expect(sheet(page)).toBeVisible();
  await back(page);
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole('button', {name: /^Resume /})).toBeVisible();
  await expect.poll(() => depth(page)).toBe(0);
  // Resuming makes the workout a layer again.
  await page.getByRole('button', {name: /^Resume /}).click();
  await expect(sheet(page)).toBeVisible();
  await back(page);
  await expect(sheet(page)).toBeHidden();
});

test('back on the phone workout opened at launch minimizes it after the first tap', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'The workout covers the tabs only on phones.');
  await start(page);
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByLabel('WORKOUT NAME').click();
  await expect.poll(() => depth(page)).toBe(1);
  await back(page);
  await expect(sheet(page)).toBeHidden();
});

test('a refused back keeps the next back inside the app', async ({page}) => {
  // Driven from the browser side, like the gesture: an in-page history.back() counts as a tap.
  // Chrome lets the gesture skip entries a page adds without a fresh tap, and reports it.
  const cdp = await page.context().newCDPSession(page);
  const skippable: string[] = [];
  cdp.on('Audits.issueAdded', ({issue}) => {
    const type = (issue.details as {genericIssueDetails?: {errorType?: string}}).genericIssueDetails
      ?.errorType;
    if (type === 'NavigationEntryMarkedSkippable') skippable.push(type);
  });
  await cdp.send('Audits.enable');
  const browserBack = async () => {
    const {currentIndex, entries} = await cdp.send('Page.getNavigationHistory');
    await cdp.send('Page.navigateToHistoryEntry', {entryId: entries[currentIndex - 1].id});
  };
  await start(page);
  await navigate(page, 'History');
  await editNewestWorkout(page);
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await editor.getByLabel('Workout name').fill('Kept through two backs');
  for (let i = 0; i < 2; i++) {
    await browserBack();
    await expect(editor.getByRole('group', {name: 'Discard changes?'})).toBeVisible();
    await expect.poll(() => depth(page)).toBe(1);
  }
  await expect(editor.getByLabel('Workout name')).toHaveValue('Kept through two backs');
  // Audit issues arrive asynchronously; give a late one time to land before asserting none.
  await page.waitForTimeout(300);
  expect(skippable).toEqual([]);
});

test('a relaunch with the phone workout open keeps back in the app before any tap', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'The workout covers the tabs only on phones.');
  await start(page);
  await sheet(page).getByLabel('WORKOUT NAME').click();
  await expect.poll(() => depth(page)).toBe(1);
  // Android restoring a discarded tab: a fresh document with no tap yet.
  await page.addInitScript(() => {
    let active = false;
    addEventListener('pointerdown', (e) => e.isTrusted && (active = true), true);
    Object.defineProperty(UserActivation.prototype, 'hasBeenActive', {get: () => active});
  });
  await page.reload();
  await expect(sheet(page)).toBeVisible();
  // The entry from before the reload must still be there for the sheet, with no tap yet.
  await expect.poll(() => depth(page)).toBe(1);
  const cdp = await page.context().newCDPSession(page);
  const {currentIndex, entries} = await cdp.send('Page.getNavigationHistory');
  await cdp.send('Page.navigateToHistoryEntry', {entryId: entries[currentIndex - 1].id});
  await expect(sheet(page)).toBeHidden();
  expect(page.url()).toContain('demo=1');
});

test('a reload with nothing open trims its leftover entry on the first tap', async ({page}) => {
  await start(page);
  // Discard the demo workout so nothing reopens as a layer after the reload.
  await page.getByRole('button', {name: 'Cancel workout', exact: true}).click();
  await page.getByRole('button', {name: 'Discard workout', exact: true}).click();
  await expect(sheet(page)).toHaveCount(0);
  await navigate(page, 'Exercises');
  await page.getByRole('button', {name: /^Bench Press \(Barbell\)/}).click();
  await expect.poll(() => depth(page)).toBe(1);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole('heading', {name: 'Workout', level: 1}).click();
  await expect.poll(() => depth(page)).toBe(0);
});

test('back on an edited history workout asks before discarding', async ({page}) => {
  await start(page);
  await navigate(page, 'History');
  await editNewestWorkout(page);
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await editor.getByLabel('Workout name').fill('Renamed by back test');
  await back(page);
  // Unsaved changes are never dropped by back; the editor stays with the discard prompt.
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('group', {name: 'Discard changes?'})).toBeVisible();
  await expect(editor.getByLabel('Workout name')).toHaveValue('Renamed by back test');
  await expect.poll(() => depth(page)).toBe(1);
  await editor.getByRole('button', {name: 'Discard changes'}).click();
  await expect(editor).toBeHidden();
  await expect.poll(() => depth(page)).toBe(0);
  // Without changes, back simply closes it.
  await editNewestWorkout(page);
  await expect(editor).toBeVisible();
  await back(page);
  await expect(editor).toBeHidden();
});
