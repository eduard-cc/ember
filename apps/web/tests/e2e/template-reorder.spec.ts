import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

const demo = ['Upper body A', 'Lower body', 'Pull + core'];

const titles = (page: Page) => page.locator('.template-card h3');
const rows = (page: Page) => page.locator('.reorder-row');

async function open(page: Page) {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await expect(titles(page)).toHaveText(demo);
}

/** Press and hold a template card with the mouse until the compact list appears. */
async function lift(page: Page, name: string) {
  const card = page.locator('.template-card', {hasText: name});
  await card.scrollIntoViewIfNeeded();
  // A scroll during the hold means the press was a scroll, not a hold.
  await page.waitForTimeout(150);
  const box = (await card.locator('h3').boundingBox())!;
  const point = {x: box.x + 40, y: box.y + box.height / 2};
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByRole('list', {name: 'Reorder templates'})).toBeVisible();
  return point;
}

async function dragTo(page: Page, from: {x: number; y: number}, slot: number) {
  const target = (await rows(page).nth(slot).boundingBox())!;
  const held = (await page.locator('.reorder-row[data-held]').boundingBox())!;
  const grab = from.y - (held.y + held.height / 2);
  await page.mouse.move(from.x, target.y + target.height / 2 + grab, {steps: 12});
}

test('holding a template card collapses the templates and dragging reorders them, kept after reload', async ({
  page,
}) => {
  await open(page);
  const point = await lift(page, 'Upper body A');
  await expect(rows(page).locator('.reorder-name')).toHaveText(demo);
  await expect(rows(page).first()).toHaveAttribute('data-held', 'true');
  await expect(rows(page).locator('.reorder-count')).toHaveText([
    '5 exercises',
    '4 exercises',
    '6 exercises',
  ]);
  await expect(page.locator('.template-grid')).toBeHidden();
  await dragTo(page, point, 2);
  await page.mouse.up();

  const moved = ['Lower body', 'Pull + core', 'Upper body A'];
  await expect(titles(page)).toHaveText(moved);
  // The release didn't open the dropped template's preview.
  await expect(page.locator('.template-preview')).toHaveCount(0);
  await expect(
    page
      .locator('[data-template-announcement]')
      .getByText('Moved Upper body A to position 3 of 3', {exact: true}),
  ).toBeAttached();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await navigate(page, 'Workouts');
  await expect(titles(page)).toHaveText(moved);
});

test('a short press opens the preview, and Escape puts a held template back', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Open template Lower body', exact: true}).click();
  await expect(page.locator('.template-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.template-preview')).toHaveCount(0);

  const point = await lift(page, 'Lower body');
  await dragTo(page, point, 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(titles(page)).toHaveText(demo);
});

test('the ⋯ menu moves a template up and down', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Template options for Upper body A', exact: true}).click();
  await expect(page.getByRole('menuitem', {name: 'Move up'})).toHaveCount(0);
  await page.getByRole('menuitem', {name: 'Move down'}).click();
  await expect(titles(page)).toHaveText(['Lower body', 'Upper body A', 'Pull + core']);
  await expect(
    page
      .locator('[data-template-announcement]')
      .getByText('Moved Upper body A to position 2 of 3', {exact: true}),
  ).toBeAttached();
  await page.getByRole('button', {name: 'Template options for Upper body A', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Move up'}).click();
  await expect(titles(page)).toHaveText(demo);
});
