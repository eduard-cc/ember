import {type Page, expect, test} from '@playwright/test';

import {addExercise, navigate} from '../navigation';

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
  if (info.project.name === 'mobile') {
    const search = picker.getByLabel('Search exercises');
    await search.focus();
    await page.setViewportSize({width: 412, height: 390});
    await expect
      .poll(async () => {
        const r = (await search.boundingBox())!;
        return r.y >= 14 && r.y + r.height <= 376;
      })
      .toBe(true);
    await page.setViewportSize({width: 412, height: 915});
    await search.blur();
  }
  // Only body parts that hold exercises; every demo name is in the catalog, so no Other.
  await expect(picker.getByRole('group', {name: 'Body part'}).getByRole('button')).toHaveText([
    'All',
    'Chest',
    'Back',
    'Shoulders',
    'Arms',
    'Legs',
    'Core',
    'Cardio',
    'Full body',
  ]);
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
  await openPicker(page);
  const cdp = await page.context().newCDPSession(page);
  const {currentIndex, entries} = await cdp.send('Page.getNavigationHistory');
  await cdp.send('Page.navigateToHistoryEntry', {entryId: entries[currentIndex - 1].id});
  await expect(picker).toBeHidden();
  await expect(cards).toHaveCount(before);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('61');
});
test('adding an exercise already in the workout explains why and keeps the draft unchanged', async ({
  page,
}, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({width: 412, height: 915});
  await page.goto('/?demo=1');
  const cards = page.locator('.workout-sheet .exercise-card');
  await expect(cards).toHaveCount(5);
  await page.getByLabel('Weight for Bench Press (Barbell) set 1').fill('61');
  const picker = await openPicker(page);
  await picker.getByLabel('Search exercises').fill('Bench Press (Barbell)');
  await picker.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).click();
  await expect(picker.getByRole('alert')).toHaveText(
    'Bench Press (Barbell) is already in this workout.',
  );
  await expect(picker).toBeVisible();
  await picker.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).click();
  await expect(picker.getByRole('alert')).toBeVisible();
  await picker.getByLabel('Search exercises').fill('Plank');
  await picker.getByRole('button', {name: 'Plank', exact: true}).click();
  await expect(picker).toBeHidden();
  await expect(cards).toHaveCount(6);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('61');
  await page.reload();
  await expect(cards).toHaveCount(6);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('61');
});

test('unknown exercise searches only offer existing library exercises', async ({page}) => {
  await page.goto('/?demo=1');
  const cards = page.locator('.workout-sheet .exercise-card');
  await expect(cards).toHaveCount(5);
  const picker = await openPicker(page);
  await picker.getByLabel('Search exercises').fill('Sled Push Synthetic');
  await expect(picker.getByRole('heading', {name: 'No matching exercise'})).toBeVisible();
  await expect(picker.getByRole('button', {name: /^Create /})).toHaveCount(0);
  await expect(picker.getByRole('group', {name: 'Exercise type'})).toHaveCount(0);
  await picker.getByLabel('Search exercises').fill('Plank');
  await picker.getByRole('button', {name: 'Plank', exact: true}).click();
  await expect(picker).toBeHidden();
  await expect(cards).toHaveCount(6);
  await expect(page.getByLabel('Seconds for Plank set 1')).toHaveValue('60');
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
  await openPicker(page);
  await picker.getByLabel('Search exercises').fill('Squat (Barbell)');
  await picker.getByRole('button', {name: 'Squat (Barbell)', exact: true}).click();
  await expect(picker.getByRole('alert')).toHaveText('Squat (Barbell) is already in this workout.');
  await picker.getByRole('button', {name: 'Close exercise picker'}).click();
  await expect(page.locator('.template-editor .exercise-card')).toHaveCount(1);
  for (const name of ['Pull Up', 'Plank', 'Rowing (Machine)', 'Pull Up (Assisted)'])
    await addExercise(page, name);
  const editor = page.locator('.template-editor');
  for (const [name, headers] of [
    ['Pull Up', ['Set', 'Reps']],
    ['Plank', ['Set', 'Seconds']],
    ['Rowing (Machine)', ['Set', 'Seconds', 'km']],
    ['Pull Up (Assisted)', ['Set', 'Assist. kg', 'Reps']],
  ] as const) {
    await expect(
      editor
        .locator('.exercise-card')
        .filter({has: page.getByRole('heading', {name, exact: true})})
        .locator('.set-head > span:not(.desktop-remove)'),
    ).toHaveText([...headers]);
  }
  await expect(editor.getByLabel('Reps for Pull Up set 1', {exact: true})).toHaveValue('9');
  await expect(editor.getByLabel('Seconds for Plank set 1')).toHaveValue('60');
  await expect(editor.getByLabel('Distance in km for Rowing (Machine) set 1')).toHaveValue('1');
  await editor.getByLabel('Reps for Pull Up set 1', {exact: true}).fill('');
  // A template may keep blank targets; it does not invent completed sets.
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  const card = page.locator('.template-card', {hasText: 'Picker template'});
  await expect(card.locator('.exercise-line')).toHaveCount(4);
  await expect(card).toContainText('+ 1 more');
  await expect(card.locator('.exercise-line').first()).toContainText('Squat (Barbell)');
});
