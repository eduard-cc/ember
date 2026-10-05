import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

async function openPicker(page: Page) {
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await expect(picker).toBeVisible();
  return picker;
}

test('Add exercise opens the searchable library and tapping a row adds it to the workout', async ({
  page,
}, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({width: 412, height: 915});
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const cards = page.locator('.workout-sheet .exercise-card');
  await expect(cards).toHaveCount(5);
  const before = await cards.count();
  const picker = await openPicker(page);
  // Same list as the Exercises tab: search, body-part chips, Recent and All sections.
  await expect(picker.getByLabel('Search exercises')).toBeVisible();
  await expect(picker.getByRole('group', {name: 'Body part'})).toBeVisible();
  await expect(picker.getByRole('region', {name: 'Recent exercises'})).toBeVisible();
  await picker
    .getByRole('group', {name: 'Body part'})
    .getByRole('button', {name: 'Core', exact: true})
    .click();
  await expect(
    picker
      .getByRole('region', {name: 'All exercises'})
      .getByRole('button', {name: 'Plank', exact: true}),
  ).toBeVisible();
  await picker.getByLabel('Search exercises').fill('plank');
  const row = picker.getByRole('button', {name: 'Plank', exact: true});
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  const close = picker.getByRole('button', {name: 'Close exercise picker'});
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  const sheet = (await picker.boundingBox())!;
  expect(sheet.width).toBe(info.project.name === 'mobile' ? 412 : 1440);
  expect(sheet.height).toBe(info.project.name === 'mobile' ? 915 : 1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    info.project.name === 'mobile' ? 412 : 1440,
  );
  await row.click();
  await expect(picker).toBeHidden();
  // The existing draft is kept and the new exercise uses its latest history as targets.
  await expect(cards).toHaveCount(before + 1);
  await expect(cards.last().getByRole('heading', {name: 'Plank'})).toBeVisible();
  await expect(page.getByLabel('Seconds for Plank set 1')).toHaveValue('60');
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toBeVisible();
});

test('closing the exercise picker keeps the active workout unchanged', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByLabel('Weight for Bench Press (Barbell) set 1').fill('61');
  const cards = page.locator('.workout-sheet .exercise-card');
  await expect(cards).toHaveCount(5);
  const before = await cards.count();
  const picker = await openPicker(page);
  await picker.getByRole('button', {name: 'Close exercise picker'}).click();
  await expect(picker).toBeHidden();
  await expect(cards).toHaveCount(before);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('61');
  await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(cards).toHaveCount(before);
});
test('a search without an exact match offers to create a custom exercise with a chosen type', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const picker = await openPicker(page);
  await picker.getByLabel('Search exercises').fill('Plank');
  // An exact catalog name never offers a duplicate custom exercise.
  await expect(picker.getByRole('button', {name: /^Create /})).toHaveCount(0);
  await picker.getByLabel('Search exercises').fill('Sled Push Synthetic');
  await picker.getByRole('button', {name: 'Create "Sled Push Synthetic"', exact: true}).click();
  const types = picker.getByRole('group', {name: 'Exercise type'});
  for (const type of ['Weighted', 'Assisted', 'Bodyweight', 'Duration', 'Cardio']) {
    const box = (await types.getByRole('button', {name: type, exact: true}).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await types.getByRole('button', {name: 'Cardio', exact: true}).click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel('Seconds for Sled Push Synthetic set 1')).toHaveValue('');
  await expect(page.getByLabel('Distance in km for Sled Push Synthetic set 1')).toBeVisible();
});
test('the template editor adds exercises through the same picker', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Picker template');
  const picker = await openPicker(page);
  await picker.getByLabel('Search exercises').fill('Squat (Barbell)');
  await picker.getByRole('button', {name: 'Squat (Barbell)', exact: true}).click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel('Weight for Squat (Barbell) set 1')).toHaveValue('85');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  const card = page.locator('.template-card', {hasText: 'Picker template'});
  await expect(card.locator('.template-open li')).toHaveText(['3 × Squat (Barbell)']);
});
