import {type Page, expect, test} from '@playwright/test';

import {navigate, openImport} from '../navigation';

const sortKey = 'ember:exercise-sort:v1';
// Synthetic demo history: 24 workouts across three templates repeated eight times.
// Seated Row (Cable) is in two templates (16 workouts); every other demo exercise has 8.
async function openExercises(page: Page, storedSort?: string) {
  if (storedSort !== undefined)
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [sortKey, storedSort],
    );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'Exercises');
  return page.getByRole('region', {name: 'All exercises'});
}
type List = ReturnType<Page['getByRole']>;
const rowNames = (all: List) =>
  all.locator('.exercise-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
/** Name, displayed count (0 when absent) and body part of every row, in display order. */
const readRows = (all: List) =>
  all.locator('.exercise-row').evaluateAll((rows) =>
    rows.map((r) => ({
      name: r.getAttribute('aria-label')!,
      count: Number(r.querySelector('.exercise-row-count')?.textContent ?? 0),
      part: r.querySelector('.exercise-row-text small')?.textContent ?? '',
    })),
  );
const byName = (a: string, b: string) => a.localeCompare(b);
/** The Most done order derived from the counts on screen: count desc, then name A–Z. */
const mostDoneOrder = (rows: {name: string; count: number}[]) =>
  [...rows].sort((a, b) => b.count - a.count || byName(a.name, b.name)).map((r) => r.name);

test('session count sits at the far right as a bare number, absent when never done', async ({
  page,
}) => {
  const all = await openExercises(page);
  const row = all.getByRole('button', {name: 'Seated Row (Cable)', exact: true});
  const count = row.locator('.exercise-row-count');
  await expect(count).toHaveText('16');
  await expect(row).not.toContainText('session');
  await expect(row).toHaveAccessibleDescription('Performed in 16 workouts');
  const rowBox = (await row.boundingBox())!;
  const countBox = (await count.boundingBox())!;
  expect(rowBox.x + rowBox.width - (countBox.x + countBox.width)).toBeLessThanOrEqual(12);
  const style = await count.evaluate((el) => {
    const s = getComputedStyle(el);
    return {weight: Number(s.fontWeight), numeric: s.fontVariantNumeric};
  });
  expect(style.weight).toBeGreaterThanOrEqual(600);
  expect(style.numeric).toContain('tabular-nums');
  await expect(
    page
      .getByRole('region', {name: 'Recent exercises'})
      .getByRole('button', {name: 'Plank', exact: true})
      .locator('.exercise-row-count'),
  ).toHaveText('8');
  const never = all.getByRole('button', {name: 'Ab Wheel', exact: true});
  await expect(never).toBeVisible();
  await expect(never.locator('.exercise-row-count')).toHaveCount(0);
  await expect(never).not.toContainText('session');
  await expect(page.locator('.exercises-view')).not.toContainText(/\d+ sessions?\b/);
});

test('sort toggle orders A–Z or by most done, persists across reload and respects search', async ({
  page,
}) => {
  const all = await openExercises(page);
  const sort = page.getByRole('group', {name: 'Sort exercises'});
  const az = sort.getByRole('button', {name: 'A–Z', exact: true});
  const most = sort.getByRole('button', {name: 'Most done', exact: true});
  await expect(az).toHaveAttribute('aria-pressed', 'true');
  await expect(most).toHaveAttribute('aria-pressed', 'false');
  for (const button of [az, most]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const alphabetical = await rowNames(all);
  expect(alphabetical).toEqual([...alphabetical].sort((a, b) => a!.localeCompare(b!)));

  await most.click();
  await expect(most).toHaveAttribute('aria-pressed', 'true');
  await expect(az).toHaveAttribute('aria-pressed', 'false');
  const rows = await readRows(all);
  const byCount = rows.map((r) => r.name);
  // Expected order comes from the counts read off the rows, not from the demo data's shape.
  expect(byCount).toEqual(mostDoneOrder(rows));
  expect(new Set(rows.map((r) => r.count)).size).toBeGreaterThan(2);
  expect(rows.at(-1)!.count).toBe(0);
  expect([...byCount].sort(byName)).toEqual(alphabetical);

  // Search narrows the sorted list without losing the chosen order.
  await page.getByLabel('Search exercises').fill('row');
  await expect(all.locator('.exercise-row').first()).toHaveAttribute('aria-label', /row/i);
  const searched = await readRows(all);
  expect(searched.length).toBeGreaterThan(1);
  expect(searched.every((r) => r.name.toLowerCase().includes('row'))).toBe(true);
  expect(searched.map((r) => r.name)).toEqual(mostDoneOrder(searched));

  await most.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(most).toBeFocused();
  expect(await most.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');

  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'Exercises');
  await expect(
    page.getByRole('group', {name: 'Sort exercises'}).getByRole('button', {name: 'Most done'}),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await rowNames(page.getByRole('region', {name: 'All exercises'}))).toEqual(byCount);
  await page
    .getByRole('group', {name: 'Sort exercises'})
    .getByRole('button', {name: 'A–Z', exact: true})
    .click();
  const back = await rowNames(page.getByRole('region', {name: 'All exercises'}));
  expect(back).toEqual(alphabetical);
});

test('body-part filter combined with Most done keeps the count order within that part', async ({
  page,
}) => {
  const all = await openExercises(page, 'most');
  await expect(
    page.getByRole('group', {name: 'Sort exercises'}).getByRole('button', {name: 'Most done'}),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', {name: 'Body part'}).getByRole('button', {name: 'Back'}).click();
  await expect(page.getByRole('region', {name: 'Recent exercises'})).toHaveCount(0);
  const rows = await readRows(all);
  expect(rows.length).toBeGreaterThan(2);
  expect(rows.every((r) => r.part === 'Back')).toBe(true);
  expect(new Set(rows.map((r) => r.count)).size).toBeGreaterThan(1);
  expect(rows.map((r) => r.name)).toEqual(mostDoneOrder(rows));
});

test('an unknown stored sort falls back to A–Z', async ({page}) => {
  const all = await openExercises(page, 'garbage');
  const sort = page.getByRole('group', {name: 'Sort exercises'});
  await expect(sort.getByRole('button', {name: 'A–Z', exact: true})).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(sort.getByRole('button', {name: 'Most done'})).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const names = await rowNames(all);
  expect(names.length).toBeGreaterThan(10);
  expect(names).toEqual([...names].sort((a, b) => byName(a!, b!)));
});

test('the Add exercise picker ignores a stored Most done sort and stays A–Z', async ({page}) => {
  await page.addInitScript(([key]) => localStorage.setItem(key, 'most'), [sortKey]);
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('group', {name: 'Body part'})).toBeVisible();
  await expect(picker.getByRole('group', {name: 'Sort exercises'})).toHaveCount(0);
  await expect(picker.getByRole('button', {name: 'Most done'})).toHaveCount(0);
  const rows = await readRows(picker.getByRole('region', {name: 'All exercises'}));
  expect(rows.length).toBeGreaterThan(10);
  // Counts still show, but they don't drive the order.
  expect(new Set(rows.map((r) => r.count)).size).toBeGreaterThan(1);
  expect(rows.map((r) => r.name)).toEqual(rows.map((r) => r.name).sort(byName));
  expect(rows.map((r) => r.name)).not.toEqual(mostDoneOrder(rows));
  expect(await page.evaluate((key) => localStorage.getItem(key), sortKey)).toBe('most');
});

const longName = 'Incline Bench Press (Dumbbell, Neutral Grip)';
/** Strong CSV: `workouts` dated workouts of the long-named exercise; the first also repeats it as a second block. */
function longHistoryCsv(workouts: number) {
  const lines = [
    'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration',
  ];
  for (let i = 0; i < workouts; i++) {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    lines.push(`${date} 12:00:00;Synthetic ${i};${longName};1;20;kg;8;;40m`);
    if (i === 0)
      lines.push(
        `${date} 12:00:00;Synthetic ${i};Plank;1;;;;60;40m`,
        `${date} 12:00:00;Synthetic ${i};${longName};1;22;kg;6;;40m`,
      );
  }
  return lines.join('\n');
}

test('a long name wraps beside a 3-digit count, and the detail header counts workouts, not blocks', async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await openImport(page);
  await page.getByLabel('Choose CSV file').setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(longHistoryCsv(120)),
  });
  await page.getByRole('button', {name: 'Replace history', exact: true}).click();
  await expect(
    page.getByRole('dialog', {name: 'Settings'}).getByText(/History replaced/),
  ).toBeVisible();
  await page.getByRole('button', {name: 'Close settings'}).click();
  await navigate(page, 'Exercises');
  const all = page.getByRole('region', {name: 'All exercises'});
  const row = all.getByRole('button', {name: longName, exact: true});
  const count = row.locator('.exercise-row-count');
  // 120 dated workouts; the repeated block in the first one still counts once.
  await expect(count).toHaveText('120');
  await expect(row).toHaveAccessibleDescription('Performed in 120 workouts');
  const layout = await row.evaluate((el) => {
    const box = (node: Element) => node.getBoundingClientRect();
    const name = el.querySelector('.exercise-row-text strong')!;
    const countEl = el.querySelector('.exercise-row-count')!;
    const lineHeight = parseFloat(getComputedStyle(name).lineHeight);
    return {
      row: box(el).toJSON() as DOMRect,
      name: box(name).toJSON() as DOMRect,
      count: box(countEl).toJSON() as DOMRect,
      lines: Math.round(name.clientHeight / lineHeight),
      clipped: name.scrollHeight > name.clientHeight + 1,
      countClipped: countEl.scrollWidth > countEl.clientWidth + 1,
    };
  });
  // The name wraps to a second line instead of an ellipsis on one line, and fits in two.
  expect(layout.lines).toBe(2);
  expect(layout.clipped).toBe(false);
  // The count stays whole, to the right of the name, inside the row.
  expect(layout.countClipped).toBe(false);
  expect(layout.count.left).toBeGreaterThanOrEqual(layout.name.right);
  expect(layout.count.right).toBeLessThanOrEqual(layout.row.right);
  expect(layout.count.width).toBeGreaterThan(20);
  expect(layout.row.height).toBeGreaterThanOrEqual(44);
  expect(layout.name.bottom).toBeLessThanOrEqual(layout.row.bottom);

  await row.click();
  const header = page.locator('.detail-header');
  await expect(header.getByRole('heading', {name: longName})).toBeVisible();
  await expect(header).toContainText('120 workouts');
  await expect(header).not.toContainText(/sessions?/);
});
