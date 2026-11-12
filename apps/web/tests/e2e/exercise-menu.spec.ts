import {type Page, expect, test} from '@playwright/test';

import {escapeAsMenuTakesFocus, navigate, templateAction} from '../navigation';

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

/** By label, not role: while the phone drawer is open the ledger behind it is aria-hidden. */
function options(page: Page, name: string) {
  return page.locator(`button[aria-label="Exercise options for ${name}"]`);
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

  // A real pointer tap at the spot, not a locator click: the closing tap is caught on purpose
  // (by the backdrop on desktop, by the drawer's scrim on phones).
  const meta = (await page.locator('.workout-sheet .workout-meta').boundingBox())!;
  await trigger.click();
  await expect(menu).toBeVisible();
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
  await expect(picker.getByText('Replacing: Seated Row (Cable)', {exact: true})).toBeVisible();
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

test('cancelling the replace picker goes back to the unchanged workout', async ({page}) => {
  const cards = await start(page);
  await page.getByLabel('Weight for Seated Row (Cable) set 1').fill('47');
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  const picker = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  // The picker sits on the workout, so its dismiss control is Back.
  await expect(picker.getByRole('button', {name: 'Close exercise picker'})).toHaveCount(0);
  await picker.getByRole('button', {name: 'Back to workout'}).click();
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

  // The back gesture closes only the picker, leaving the workout open under it.
  const cdp = await page.context().newCDPSession(page);
  const skippable: string[] = [];
  cdp.on('Audits.issueAdded', ({issue}) => {
    const type = (issue.details as {genericIssueDetails?: {errorType?: string}}).genericIssueDetails
      ?.errorType;
    if (type === 'NavigationEntryMarkedSkippable') skippable.push(type);
  });
  await cdp.send('Audits.enable');
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  await expect(picker).toBeVisible();
  const {currentIndex, entries} = await cdp.send('Page.getNavigationHistory');
  await cdp.send('Page.navigateToHistoryEntry', {entryId: entries[currentIndex - 1].id});
  await expect(picker).toBeHidden();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  await expect(page.getByLabel('Weight for Seated Row (Cable) set 1')).toHaveValue('47');
  await expect(options(page, 'Seated Row (Cable)')).toBeFocused();
  await page.waitForTimeout(300);
  expect(skippable).toEqual([]);
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
  const editor = page.locator('.template-editor');
  await options(page, 'Squat (Barbell)').click();
  // Escape reaches the menu once it has taken focus.
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('menuitem', {name: 'Replace exercise'})).toBeHidden();
  expect(await page.getByRole('dialog', {name: 'Discard changes?'}).count()).toBe(0);
  await expect(options(page, 'Squat (Barbell)')).toBeFocused();
  // An Escape pressed as the menu takes focus also closes only the menu.
  await escapeAsMenuTakesFocus(page, () => options(page, 'Squat (Barbell)').click());
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(await page.getByRole('dialog', {name: 'Discard changes?'}).count()).toBe(0);
  await expect(options(page, 'Squat (Barbell)')).toBeFocused();
  await options(page, 'Squat (Barbell)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  const picker = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await expect(picker.getByText('Replacing: Squat (Barbell)', {exact: true})).toBeVisible();
  await picker.getByLabel('Search exercises').fill('Plank');
  await expect(picker.getByRole('button', {name: 'Plank', exact: true})).toContainText(
    'Already in template',
  );
  await picker.getByRole('button', {name: 'Plank', exact: true}).click();
  await expect(page.locator('[data-sonner-toast] [data-title]')).toHaveText(
    'Plank is already in this template.',
  );
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
  await expect(card.locator('.exercise-line')).toHaveCount(1);
  await expect(card.locator('.exercise-line')).toContainText('Bench Press (Barbell)');
  await templateAction(page, 'Edit template', 'Menu template');
  await editor
    .getByRole('button', {name: 'Exercise options for Bench Press (Barbell)', exact: true})
    .click();
  // Escape reaches the menu once it has taken focus.
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('menuitem', {name: 'Replace exercise'})).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
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
  await expect(page.locator('[data-sonner-toast] [data-title]')).toHaveText(
    'Bench Press (Barbell) is already in this workout.',
  );
  await picker.getByRole('button', {name: 'Back to workout'}).click();
  await expect(cards.locator('h2')).toHaveText(demo);
  await expect(page.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue('61');
  await options(page, 'Seated Row (Cable)').click();
  await page.getByRole('menuitem', {name: 'Replace exercise'}).click();
  // No refusal carries over to the reopened picker.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
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
  const box = (await complete.boundingBox())!;
  await options(page, 'Bench Press (Barbell)').click();
  const menu = page.getByRole('menu', {name: 'Exercise options for Bench Press (Barbell)'});
  await expect(menu).toBeVisible();
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

    test('⋯ opens a bottom drawer with every item visible and tappable', async ({page}) => {
      const cards = await start(page);
      const last = 'Pull Up (Assisted)';
      await options(page, last).scrollIntoViewIfNeeded();
      await options(page, last).click();
      const menu = page.getByRole('menu', {name: `Exercise options for ${last}`});
      await expect(menu).toBeVisible();
      const drawer = page.getByRole('dialog', {name: last});
      await expect(drawer).toBeVisible();
      // Once the drawer has settled: anchored to the bottom edge, every row at least 44px.
      await expect
        .poll(async () => {
          const box = (await drawer.boundingBox())!;
          return Math.round(box.y + box.height);
        })
        .toBe(viewport.height);
      await expect(menu.getByRole('menuitem')).toHaveText([
        'Replace exercise',
        'Move up',
        'Remove exercise',
      ]);
      for (const item of await menu.getByRole('menuitem').all()) {
        const box = (await item.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      await menu.getByRole('menuitem', {name: 'Remove exercise'}).click();
      await expect(cards.locator('h2')).toHaveText(demo.filter((name) => name !== last));
      await expect(drawer).toHaveCount(0);
    });
  });
}

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

test('the ⋯ dots sit centred in their target and end flush with the completion boxes', async ({
  page,
}) => {
  const cards = await start(page);
  const card = cards.first();
  const icon = (await options(page, 'Bench Press (Barbell)').locator('svg').boundingBox())!;
  const check = card.getByRole('button', {name: /^Complete .* set 1$/});
  const box = (await check.locator('.check-box').boundingBox())!;
  const trigger = (await options(page, 'Bench Press (Barbell)').boundingBox())!;
  // Lucide's ellipsis draws its last dot ending at 20 of 24 viewBox units.
  const dotsRight = icon.x + (icon.width * 20) / 24;
  expect(Math.abs(dotsRight - (box.x + box.width))).toBeLessThanOrEqual(1);
  // The drawn dots are centred in the 44px target, so its pressed and open wash surrounds them.
  expect(trigger.width).toBeGreaterThanOrEqual(44);
  const dotsLeft = icon.x + (icon.width * 4) / 24;
  expect(
    Math.abs(dotsLeft - trigger.x - (trigger.x + trigger.width - dotsRight)),
  ).toBeLessThanOrEqual(1);
  // The wash stays on the card.
  expect(trigger.x + trigger.width).toBeLessThanOrEqual(
    (await card.boundingBox())!.x + (await card.boundingBox())!.width,
  );
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
