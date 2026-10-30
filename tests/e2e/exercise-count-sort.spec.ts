import {type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

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

test('sort toggle orders by most done first or A–Z, persists across reload and respects search', async ({
  page,
}) => {
  const all = await openExercises(page);
  const sort = page.getByRole('group', {name: 'Sort exercises'});
  const az = sort.getByRole('button', {name: 'A–Z', exact: true});
  const most = sort.getByRole('button', {name: 'Most done', exact: true});
  await expect(sort.getByRole('button')).toHaveText(['Most done', 'A–Z']);
  await expect(most).toHaveAttribute('aria-pressed', 'true');
  await expect(az).toHaveAttribute('aria-pressed', 'false');
  for (const button of [az, most]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const rows = await readRows(all);
  const byCount = rows.map((r) => r.name);
  // Expected order comes from the counts read off the rows, not from the demo data's shape.
  expect(byCount).toEqual(mostDoneOrder(rows));
  expect(new Set(rows.map((r) => r.count)).size).toBeGreaterThan(2);
  expect(rows.at(-1)!.count).toBe(0);

  await az.click();
  await expect(az).toHaveAttribute('aria-pressed', 'true');
  await expect(most).toHaveAttribute('aria-pressed', 'false');
  const alphabetical = await rowNames(all);
  expect(alphabetical).toEqual([...alphabetical].sort((a, b) => a!.localeCompare(b!)));
  expect([...byCount].sort(byName)).toEqual(alphabetical);

  // Search narrows the sorted list without losing the chosen order.
  await page.getByLabel('Search exercises').fill('row');
  await expect(all.locator('.exercise-row').first()).toHaveAttribute('aria-label', /row/i);
  const searched = await readRows(all);
  expect(searched.length).toBeGreaterThan(1);
  expect(searched.every((r) => r.name.toLowerCase().includes('row'))).toBe(true);
  expect(searched.map((r) => r.name)).toEqual([...searched.map((r) => r.name)].sort(byName));

  await az.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(az).toBeFocused();
  expect(await az.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');

  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'Exercises');
  await expect(
    page.getByRole('group', {name: 'Sort exercises'}).getByRole('button', {name: 'A–Z'}),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await rowNames(page.getByRole('region', {name: 'All exercises'}))).toEqual(alphabetical);
  await page
    .getByRole('group', {name: 'Sort exercises'})
    .getByRole('button', {name: 'Most done', exact: true})
    .click();
  const back = await rowNames(page.getByRole('region', {name: 'All exercises'}));
  expect(back).toEqual(byCount);
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

test('an unknown stored sort falls back to Most done', async ({page}) => {
  const all = await openExercises(page, 'garbage');
  const sort = page.getByRole('group', {name: 'Sort exercises'});
  await expect(sort.getByRole('button', {name: 'Most done'})).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(sort.getByRole('button', {name: 'A–Z', exact: true})).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const rows = await readRows(all);
  expect(rows.length).toBeGreaterThan(10);
  expect(rows.map((r) => r.name)).toEqual(mostDoneOrder(rows));
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
/** `workouts` dated workouts of the long-named exercise; the first also repeats it as a second block. */
function longHistory(workouts: number) {
  const set = (id: string, weight: number | null, reps: number | null, seconds: number | null) => ({
    id,
    weight,
    reps,
    seconds,
    distance: null,
  });
  return {
    version: 1,
    dataset: {
      sourceLabel: 'Synthetic fixture',
      workouts: Array.from({length: workouts}, (_, i) => {
        const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
        const block = (n: number, weight: number, reps: number) => ({
          name: longName,
          type: 'weighted',
          sets: [set(`s${i}-${n}`, weight, reps, null)],
        });
        return {
          id: `synthetic-${i}`,
          name: `Synthetic ${i}`,
          date: `${date}T12:00:00`,
          duration: 40,
          exercises:
            i === 0
              ? [
                  block(0, 20, 8),
                  {name: 'Plank', type: 'duration', sets: [set(`s${i}-p`, null, null, 60)]},
                  block(1, 22, 6),
                ]
              : [block(0, 20, 8)],
        };
      }).reverse(),
      warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
    },
    active: null,
    finished: [],
    templates: [],
  };
}

test('a long name wraps beside a 3-digit count, and the detail header counts workouts, not blocks', async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.addInitScript(
    (value) => localStorage.setItem('ember:v1', JSON.stringify(value)),
    longHistory(120),
  );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
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
