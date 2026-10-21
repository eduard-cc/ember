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
  const cards = page.locator('.workout-sheet .exercise-card');
  await expect(cards.locator('h2')).toHaveText(demo);
  return cards;
}

function options(page: Page, name: string) {
  return page.getByRole('button', {name: `Exercise options for ${name}`, exact: true});
}

test('the exercise options menu opens from the ⋯ button and closes with Escape or an outside tap', async ({
  page,
}) => {
  const cards = await start(page);
  const trigger = options(page, 'Bench Press (Barbell)');
  const box = (await trigger.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  const menu = page.getByRole('menu', {name: 'Exercise options for Bench Press (Barbell)'});
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Replace exercise',
    'Move down',
    'Remove exercise',
  ]);
  for (const item of await menu.getByRole('menuitem').all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(menu).toBeVisible();
  // A real pointer tap at the spot, not a locator click: the closing tap is caught on purpose.
  const meta = (await page.locator('.workout-sheet .workout-meta').boundingBox())!;
  await page.mouse.click(meta.x + 8, meta.y + meta.height / 2);
  await expect(menu).toBeHidden();
  await expect(cards).toHaveCount(5);

  // Keyboard: Enter opens with the first item focused; the focus ring is visible.
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', {name: 'Replace exercise'})).toBeFocused();
  await page.keyboard.press('End');
  const remove = menu.getByRole('menuitem', {name: 'Remove exercise'});
  await expect(remove).toBeFocused();
  expect(await remove.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await trigger.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});

test('Remove exercise removes only that exercise and the draft saves it', async ({page}) => {
  const cards = await start(page);
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Remove exercise'}).click();
  await expect(cards.locator('h2')).toHaveText(
    demo.filter((name) => name !== 'Seated Row (Cable)'),
  );
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(cards.locator('h2')).toHaveText(
    demo.filter((name) => name !== 'Seated Row (Cable)'),
  );
});

test('Replace exercise swaps in the picked exercise at the same position with fresh targets', async ({
  page,
}) => {
  const cards = await start(page);
  // Completed work on the replaced exercise is discarded with it.
  await page.getByLabel('Weight for Seated Row (Cable) set 1').fill('47');
  await page.getByRole('button', {name: 'Complete Seated Row (Cable) set 1'}).click();
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  const picker = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await expect(picker).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await picker.getByLabel('Search exercises').fill('Squat (Barbell)');
  await picker
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name: 'Squat (Barbell)', exact: true})
    .click();
  await expect(picker).toBeHidden();
  const expected = demo.map((name) => (name === 'Seated Row (Cable)' ? 'Squat (Barbell)' : name));
  await expect(cards.locator('h2')).toHaveText(expected);
  // Prefilled like a newly added exercise: latest history, nothing completed.
  const previous = await page.getByLabel('Previous for Squat (Barbell) set 1').textContent();
  const latest = /^([\d.]+) kg/.exec(previous ?? '')?.[1];
  expect(latest).toBeTruthy();
  await expect(page.getByLabel('Weight for Squat (Barbell) set 1')).toHaveValue(latest!);
  await expect(cards.nth(1).getByRole('button', {name: /^Uncomplete /})).toHaveCount(0);
  await expect(page.getByLabel('Weight for Seated Row (Cable) set 1')).toHaveCount(0);
  await expect(options(page, 'Squat (Barbell)')).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(cards.locator('h2')).toHaveText(expected);
  await expect(page.getByLabel('Weight for Squat (Barbell) set 1')).toHaveValue(latest!);
});

test('cancelling the replace picker leaves the workout unchanged', async ({page}) => {
  const cards = await start(page);
  await page.getByLabel('Weight for Seated Row (Cable) set 1').fill('47');
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  const picker = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await picker.getByRole('button', {name: 'Close exercise picker'}).click();
  await expect(picker).toBeHidden();
  await expect(cards.locator('h2')).toHaveText(demo);
  await expect(page.getByLabel('Weight for Seated Row (Cable) set 1')).toHaveValue('47');
  await expect(options(page, 'Seated Row (Cable)')).toBeFocused();

  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(cards.locator('h2')).toHaveText(demo);
  await expect(page.getByLabel('Weight for Seated Row (Cable) set 1')).toHaveValue('47');
});

test('the template editor offers the same Replace and Remove menu', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  await page.getByLabel('Template name').fill('Menu template');
  for (const name of ['Squat (Barbell)', 'Plank']) {
    await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
    const add = page.getByRole('dialog', {name: 'Add exercise', exact: true});
    await add.getByLabel('Search exercises').fill(name);
    await add
      .getByRole('region', {name: 'All exercises'})
      .getByRole('button', {name, exact: true})
      .click();
    await expect(add).toBeHidden();
  }
  await options(page, 'Squat (Barbell)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  const picker = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await picker.getByLabel('Search exercises').fill('Bench Press (Barbell)');
  await picker
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name: 'Bench Press (Barbell)', exact: true})
    .click();
  await expect(picker).toBeHidden();
  // The replacement keeps the first position rather than moving to the end.
  await expect(page.locator('.template-editor .exercise-card h2')).toHaveText([
    'Bench Press (Barbell)',
    'Plank',
  ]);
  await options(page, 'Plank').click();
  await page.getByRole('menuitem', {name: 'Remove exercise'}).click();
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  const card = page.locator('.template-card', {hasText: 'Menu template'});
  await expect(card.locator('.template-open li')).toHaveText([/× Bench Press \(Barbell\)$/]);
});

test('replacing with another exercise already in the workout keeps both cards unchanged', async ({
  page,
}) => {
  const cards = await start(page);
  await page.getByLabel('Weight for Bench Press (Barbell) set 1').fill('61');
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  const picker = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await picker.getByLabel('Search exercises').fill('Bench Press (Barbell)');
  await picker.getByRole('button', {name: 'Bench Press (Barbell)', exact: true}).click();
  await expect(picker.getByRole('alert')).toHaveText(
    'Bench Press (Barbell) is already in this workout.',
  );
  await picker.getByRole('button', {name: 'Close exercise picker'}).click();
  await expect(cards.locator('h2')).toHaveText(demo);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('61');
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  await expect(picker.getByRole('alert')).toHaveCount(0);
  // Choosing the card's own exercise is still valid, not a second copy.
  await picker.getByLabel('Search exercises').fill('Seated Row (Cable)');
  await picker.getByRole('button', {name: 'Seated Row (Cable)', exact: true}).click();
  await expect(picker).toBeHidden();
  await expect(cards.locator('h2')).toHaveText(demo);
  await expect(options(page, 'Seated Row (Cable)')).toBeFocused();
});

/** Open the menu, then tap set 3's Complete button: the tap only closes the menu. */
async function closingTapDoesNothingElse(page: Page, tap: (x: number, y: number) => Promise<void>) {
  await start(page);
  const complete = page.getByRole('button', {name: 'Complete Bench Press (Barbell) set 3'});
  await complete.scrollIntoViewIfNeeded();
  await expect(complete).toBeEnabled();
  await options(page, 'Bench Press (Barbell)').click();
  const menu = page.getByRole('menu', {name: 'Exercise options for Bench Press (Barbell)'});
  await expect(menu).toBeVisible();
  const box = (await complete.boundingBox())!;
  await tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(menu).toBeHidden();
  await expect(complete).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByRole('button', {name: 'Uncomplete Bench Press (Barbell) set 3'}),
  ).toHaveCount(0);
  // The next tap works normally.
  await complete.click();
  await expect(
    page.getByRole('button', {name: 'Uncomplete Bench Press (Barbell) set 3'}),
  ).toBeVisible();
}

test('the tap that closes the menu does not also press what was under it', async ({page}) => {
  await closingTapDoesNothingElse(page, (x, y) => page.mouse.click(x, y));
});

test.describe('on a touch screen', () => {
  test.use({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});

  test('the tap that closes the menu does not also press what was under it', async ({page}) => {
    await closingTapDoesNothingElse(page, (x, y) => page.touchscreen.tap(x, y));
  });
});

for (const viewport of [
  {width: 390, height: 844},
  {width: 412, height: 915},
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({viewport});

    test('near the bottom the menu opens upward with every item visible and tappable', async ({
      page,
    }) => {
      const cards = await start(page);
      const last = 'Pull Up (Assisted)';
      const trigger = options(page, last);
      const scroller = page.locator('.workout-sheet .workout-scroll');
      // Put the last card's heading just above the bottom of the scroll area.
      await trigger.evaluate((button) => {
        const scroll = button.closest('.workout-scroll')!;
        const bottom = Math.min(scroll.getBoundingClientRect().bottom, window.innerHeight);
        scroll.scrollTop += button.getBoundingClientRect().bottom - (bottom - 12);
      });
      const before = (await trigger.boundingBox())!;
      const area = (await scroller.boundingBox())!;
      expect(area.y + area.height - (before.y + before.height)).toBeLessThan(40);
      await trigger.click();
      const menu = page.getByRole('menu', {name: `Exercise options for ${last}`});
      await expect(menu).toBeVisible();
      const bottom = Math.min(area.y + area.height, viewport.height);
      for (const item of await menu.getByRole('menuitem').all()) {
        const box = (await item.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(Math.max(area.y, 0));
        expect(box.y + box.height).toBeLessThanOrEqual(bottom);
      }
      // Both items are really hit-testable, not hidden under the scroll area's clip.
      await menu.getByRole('menuitem', {name: 'Remove exercise'}).click();
      await expect(cards.locator('h2')).toHaveText(demo.filter((name) => name !== last));
    });
  });
}

test('moving focus to another ⋯ button closes the open menu', async ({page}) => {
  await start(page);
  await options(page, 'Bench Press (Barbell)').click();
  const first = page.getByRole('menu', {name: 'Exercise options for Bench Press (Barbell)'});
  await expect(first).toBeVisible();
  await options(page, 'Seated Row (Cable)').focus();
  await expect(first).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(
    page.getByRole('menu', {name: 'Exercise options for Seated Row (Cable)'}),
  ).toBeVisible();
});

test('after Remove, focus moves to the next card, the previous one, then Add exercise', async ({
  page,
}) => {
  const cards = await start(page);
  const remove = async (name: string) => {
    await options(page, name).click();
    await page.getByRole('menuitem', {name: 'Remove exercise'}).click();
    await expect(cards.locator('h2', {hasText: name})).toHaveCount(0);
  };
  await remove('Seated Row (Cable)');
  await expect(options(page, 'Incline Bench Press (Dumbbell)')).toBeFocused();
  await remove('Pull Up (Assisted)');
  await expect(options(page, 'Lateral Raise (Dumbbell)')).toBeFocused();
  for (const name of [
    'Bench Press (Barbell)',
    'Incline Bench Press (Dumbbell)',
    'Lateral Raise (Dumbbell)',
  ])
    await remove(name);
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Add exercise', exact: true})).toBeFocused();
});

test('Tab out of the menu continues from the ⋯ button', async ({page}) => {
  await start(page);
  const trigger = options(page, 'Seated Row (Cable)');
  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute('aria-label') ?? el?.textContent ?? null;
    });
  for (const key of ['Tab', 'Shift+Tab']) {
    await trigger.focus();
    await page.keyboard.press(key);
    const fromTrigger = await active();
    expect(fromTrigger).not.toBeNull();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press(key);
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await active()).toBe(fromTrigger);
  }
});

test('the ⋯ icon sits at the far right of the card, flush with the set column', async ({page}) => {
  const cards = await start(page);
  const card = cards.first();
  const icon = (await options(page, 'Bench Press (Barbell)').locator('svg').boundingBox())!;
  const check = (await card.getByRole('button', {name: /^Complete .* set 1$/}).boundingBox())!;
  const trigger = (await options(page, 'Bench Press (Barbell)').boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  // Lucide's ellipsis has ~1.5px of built-in side bearing at 18px.
  expect(Math.abs(icon.x + icon.width - (check.x + check.width))).toBeLessThanOrEqual(3);
  expect(trigger.width).toBeGreaterThanOrEqual(44);
  expect(trigger.x + trigger.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
});

test('a keyboard-focused menu item keeps its inset focus ring', async ({page}) => {
  await start(page);
  await options(page, 'Bench Press (Barbell)').focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', {name: 'Exercise options for Bench Press (Barbell)'});
  const focused = menu.getByRole('menuitem').first();
  await expect(focused).toBeFocused();
  await expect(focused).toHaveCSS('outline-offset', '-2px');
});
