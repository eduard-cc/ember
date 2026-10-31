import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

const demo = [
  'Bench Press (Barbell)',
  'Seated Row (Cable)',
  'Incline Bench Press (Dumbbell)',
  'Lateral Raise (Dumbbell)',
  'Pull Up (Assisted)',
];

async function start(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const sheet = page.getByRole('region', {name: 'Active workout'});
  await expect(sheet.locator('.exercise-card h2')).toHaveText(demo);
  return sheet;
}

function details(page: Page, name: string) {
  return page.getByRole('button', {name: `Show details for ${name}`, exact: true});
}

function detailDialog(page: Page, name: string) {
  return page.getByRole('dialog', {name, exact: true});
}

/** A real pointer tap at an element's centre, so whatever is on top there receives it. */
async function tap(page: Page, box: {x: number; y: number; width: number; height: number}) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const scrollTop = (page: Page) => page.locator('.workout-scroll').evaluate((el) => el.scrollTop);

test('tapping an exercise name or thumbnail opens its details with finished-workout history only', async ({
  page,
}, info) => {
  const sheet = await start(page);
  // Draft work is not history: an unusual value entered and completed here must not show up.
  await page.getByLabel('Weight for Seated Row (Cable) set 1').fill('97.5');
  await page.getByRole('button', {name: 'Complete Seated Row (Cable) set 1'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

  const trigger = details(page, 'Seated Row (Cable)');
  const box = (await trigger.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  // The name and the thumbnail both sit inside the one button.
  const card = sheet.locator('.exercise-card').nth(1);
  const name = (await card.getByRole('heading', {level: 2}).boundingBox())!;
  const thumb = (await card.locator('.exercise-thumb').boundingBox())!;
  for (const inner of [name, thumb]) {
    expect(inner.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }

  await tap(page, name);
  const dialog = detailDialog(page, 'Seated Row (Cable)');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', {name: 'Seated Row (Cable)', exact: true}),
  ).toBeVisible();
  await expect(dialog.getByRole('tab', {name: 'History', exact: true})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Demo history has Seated Row in two routines for eight weeks each; the draft adds nothing.
  await expect(dialog.getByText('Back · 16 workouts')).toBeVisible();
  await expect(dialog.locator('.session-card').first()).toBeVisible();
  await expect(dialog.getByText('97.5 kg', {exact: false})).toHaveCount(0);
  for (const tab of ['About', 'Charts', 'Records']) {
    await dialog.getByRole('tab', {name: tab, exact: true}).click();
    await expect(dialog.getByRole('tab', {name: tab, exact: true})).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await expect(dialog.getByText('97.5 kg', {exact: false})).toHaveCount(0);

  const panel = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (info.project.name === 'mobile') {
    // Full screen over the full-screen workout sheet.
    expect(panel.x).toBe(0);
    expect(panel.y).toBe(0);
    expect(panel.width).toBe(viewport.width);
    expect(panel.height).toBe(viewport.height);
  } else {
    // The dialog covers the actual workout column, including on ultrawide screens.
    const logger = (await page.locator('.workout-sheet').boundingBox())!;
    expect(panel.x).toBeCloseTo(logger.x, 0);
    expect(panel.width).toBeCloseTo(logger.width, 0);
  }

  await dialog.getByRole('button', {name: 'Back to workout', exact: true}).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // The thumbnail opens the right exercise too.
  const lateral = sheet.locator('.exercise-card').nth(3);
  await lateral.scrollIntoViewIfNeeded();
  await tap(page, (await lateral.locator('.exercise-thumb').boundingBox())!);
  const lateralDialog = detailDialog(page, 'Lateral Raise (Dumbbell)');
  await expect(lateralDialog).toBeVisible();
  await expect(lateralDialog.getByText('Shoulders · 8 workouts')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lateralDialog).toBeHidden();
  await expect(details(page, 'Lateral Raise (Dumbbell)')).toBeFocused();
  expect(
    await details(page, 'Lateral Raise (Dumbbell)').evaluate(
      (el) => getComputedStyle(el).outlineStyle,
    ),
  ).not.toBe('none');
});

test('closing the details with the back button or Escape returns to the workout as it was left', async ({
  page,
}) => {
  const sheet = await start(page);
  await page.getByLabel('Weight for Lateral Raise (Dumbbell) set 2').fill('12.5');
  await page.getByRole('button', {name: 'Complete Lateral Raise (Dumbbell) set 1'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const trigger = details(page, 'Lateral Raise (Dumbbell)');
  // Bring the card's heading into view, then nudge so the position is clearly not the top.
  await sheet.locator('.exercise-card').nth(3).locator('header').scrollIntoViewIfNeeded();
  await page.locator('.workout-scroll').evaluate((el) => el.scrollBy(0, 40));
  await expect(trigger).toBeInViewport();
  const before = await scrollTop(page);
  expect(before).toBeGreaterThan(0);
  const elapsed = await sheet.getByLabel('Workout duration').textContent();

  const closers = [
    async () =>
      detailDialog(page, 'Lateral Raise (Dumbbell)')
        .getByRole('button', {name: 'Back to workout', exact: true})
        .click(),
    async () => page.keyboard.press('Escape'),
  ];
  for (const close of closers) {
    await tap(page, (await trigger.boundingBox())!);
    const dialog = detailDialog(page, 'Lateral Raise (Dumbbell)');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', {name: 'Charts', exact: true}).click();
    await close();
    await expect(dialog).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(page.getByLabel('Weight for Lateral Raise (Dumbbell) set 2')).toHaveValue('12.5');
    await expect(
      page.getByRole('button', {name: 'Uncomplete Lateral Raise (Dumbbell) set 1'}),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', {name: 'Complete Lateral Raise (Dumbbell) set 2'}),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(await scrollTop(page)).toBe(before);
    await expect(trigger).toBeFocused();
  }
  // The workout clock kept running underneath.
  await expect(sheet.getByLabel('Workout duration')).not.toHaveText(elapsed!);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
});

test('the draft survives reload after opening and closing exercise details', async ({page}) => {
  const sheet = await start(page);
  await page.getByLabel('Weight for Bench Press (Barbell) set 1').fill('71');
  await page.getByRole('button', {name: 'Complete Bench Press (Barbell) set 1'}).click();
  await details(page, 'Bench Press (Barbell)').click();
  await expect(detailDialog(page, 'Bench Press (Barbell)')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detailDialog(page, 'Bench Press (Barbell)')).toBeHidden();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

  // Reloading with the details open restores the workout, not the transient details.
  await details(page, 'Bench Press (Barbell)').click();
  await expect(detailDialog(page, 'Bench Press (Barbell)')).toBeVisible();
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('71');
  await expect(
    page.getByRole('button', {name: 'Uncomplete Bench Press (Barbell) set 1'}),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the ⋯ menu stays a separate control next to the details button', async ({page}) => {
  const sheet = await start(page);
  const trigger = details(page, 'Seated Row (Cable)');
  const menuButton = page.getByRole('button', {
    name: 'Exercise options for Seated Row (Cable)',
    exact: true,
  });
  const a = (await trigger.boundingBox())!;
  const b = (await menuButton.boundingBox())!;
  expect(a.x + a.width).toBeLessThanOrEqual(b.x);

  await tap(page, b);
  const menu = page.getByRole('menu', {name: 'Exercise options for Seated Row (Cable)'});
  await expect(menu).toBeVisible();
  // The menu (a drawer on phones) opens, not the exercise details.
  await expect(page.locator('.exercise-detail-panel')).toHaveCount(0);
  await menu.getByRole('menuitem', {name: 'Remove exercise'}).click();
  await expect(sheet.locator('.exercise-card h2')).toHaveText(
    demo.filter((name) => name !== 'Seated Row (Cable)'),
  );
  await expect(trigger).toHaveCount(0);
  // Remaining cards still open their own details.
  await details(page, 'Incline Bench Press (Dumbbell)').click();
  await expect(detailDialog(page, 'Incline Bench Press (Dumbbell)')).toBeVisible();
});

test('a source workout link inside the details minimizes the workout and keeps the draft', async ({
  page,
}) => {
  const sheet = await start(page);
  await page.getByLabel('Weight for Bench Press (Barbell) set 2').fill('66');
  await details(page, 'Bench Press (Barbell)').click();
  const dialog = detailDialog(page, 'Bench Press (Barbell)');
  await dialog
    .getByRole('button', {name: /View source workout/})
    .first()
    .click();
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await page.getByRole('button', {name: /Resume Upper body A/}).click();
  await expect(sheet).toBeVisible();
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 2')).toHaveValue('66');
});

for (const width of [1000, 1440, 1920, 2560]) {
  test(`exercise details stay aligned to the workout column at ${width}px and after resize`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 915});
    await start(page);
    await details(page, demo[0]).click();
    const dialog = detailDialog(page, demo[0]);
    await expect(dialog).toBeVisible();
    for (const resizedWidth of [width, 1920, 1440]) {
      await page.setViewportSize({width: resizedWidth, height: 915});
      const logger = (await page.locator('.workout-sheet').boundingBox())!;
      const panel = (await dialog.boundingBox())!;
      expect(panel.x).toBeCloseTo(logger.x, 0);
      expect(panel.width).toBeCloseTo(logger.width, 0);
      expect(panel.y).toBeCloseTo(logger.y, 0);
      expect(panel.height).toBeCloseTo(logger.height, 0);
    }
  });
}

test('template editing keeps plain exercise headings without a details button', async ({page}) => {
  await start(page);
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Edit template Upper body A', exact: true}).click();
  await expect(page.getByLabel('Template name')).toBeVisible();
  await expect(page.locator('.library .exercise-card h2').first()).toHaveText(demo[0]);
  await expect(
    page.locator('.library').getByRole('button', {name: /^Show details for /}),
  ).toHaveCount(0);
});
