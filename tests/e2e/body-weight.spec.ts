import {type Locator, type Page, expect, test} from '@playwright/test';

import {openSettings} from '../navigation';

// Synthetic values only; never real measurements.
async function open(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await openSettings(page);
  const section = page.getByRole('region', {name: 'Body weight', exact: true});
  await expect(section).toBeVisible();
  return section;
}
async function add(section: Locator, kg: string, when?: string) {
  await section.getByRole('button', {name: 'Add weight', exact: true}).click();
  await section.getByLabel('Weight in kg', {exact: true}).fill(kg);
  if (when) await section.getByLabel('Date and time', {exact: true}).fill(when);
  await section.getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(section.getByLabel('Weight in kg', {exact: true})).toHaveCount(0);
}
const rows = (section: Locator) =>
  section.getByRole('list', {name: 'Body weight history'}).getByRole('listitem');
async function renderedLabelSize(chart: Locator) {
  return chart.locator('text').evaluateAll((labels) =>
    Math.min(
      ...labels.map((label) => {
        const transform = (label as SVGTextElement).getScreenCTM()!;
        return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(transform.a, transform.b);
      }),
    ),
  );
}

test('adds, backdates, corrects and deletes entries that survive reload, newest first', async ({
  page,
}) => {
  await page.goto('/');
  let section = await open(page);
  // No entries: one EmptyState stands in for both the chart and the list.
  await expect(section.locator('.empty-state', {hasText: 'No entries yet'})).toBeVisible();
  await expect(section.getByRole('heading', {name: 'Weight (kg)', exact: true})).toHaveCount(0);
  await expect(section.getByRole('img')).toHaveCount(0);

  // A new entry defaults to now.
  await section.getByRole('button', {name: 'Add weight', exact: true}).click();
  const now = await page.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const defaulted = await section.getByLabel('Date and time', {exact: true}).inputValue();
  expect(Math.abs(Date.parse(defaulted) - Date.parse(now))).toBeLessThanOrEqual(60_000);
  // Invalid weights are refused with a visible reason and nothing is saved.
  await section.getByLabel('Weight in kg', {exact: true}).fill('0');
  await section.getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(section.getByRole('alert')).toContainText('kg');
  await section.getByLabel('Weight in kg', {exact: true}).fill('70,4');
  await section.getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(rows(section)).toHaveCount(1);
  // One point: honest single-entry state, no line.
  await expect(section.getByRole('heading', {name: 'Weight (kg)', exact: true})).toBeVisible();
  await expect(section.locator('.empty-state', {hasText: 'One entry so far'})).toBeVisible();
  await expect(section.getByText('Add another entry', {exact: false})).toBeVisible();
  await expect(section.getByRole('img')).toHaveCount(0);

  await add(section, '71.25', '2019-01-05T08:00');
  await add(section, '69.9', '2023-06-10T07:30');
  await expect(rows(section)).toHaveCount(3);
  await expect(rows(section).nth(0)).toContainText('70.4');
  await expect(rows(section).nth(1)).toContainText('10 Jun 2023');
  await expect(rows(section).nth(1)).toContainText('07:30');
  await expect(rows(section).nth(1)).toContainText('69.9');
  await expect(rows(section).nth(2)).toContainText('5 Jan 2019');

  // The chart shows the whole history, oldest entry included.
  const chart = section.getByRole('img', {name: /Body weight over time/});
  await expect(chart.locator('circle')).toHaveCount(3);
  await expect(chart.locator('polyline')).toHaveCount(1);
  await expect(chart).toContainText('5 Jan 2019');

  // Correct an entry, including moving it in time.
  await section.getByRole('button', {name: /Edit entry 10 Jun 2023 07:30, 69.9 kg/}).click();
  await section.getByLabel('Weight in kg', {exact: true}).fill('68.75');
  await section.getByLabel('Date and time', {exact: true}).fill('2018-12-31T23:45');
  await section.getByRole('button', {name: 'Save entry', exact: true}).click();
  await expect(rows(section).nth(2)).toContainText('31 Dec 2018');
  await expect(rows(section).nth(2)).toContainText('68.75');

  // Delete is reversible with Undo, then deleted for real.
  await section.getByRole('button', {name: /Edit entry 5 Jan 2019/}).click();
  await section.getByRole('button', {name: 'Delete entry', exact: true}).click();
  await expect(rows(section)).toHaveCount(2);
  await section.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(rows(section)).toHaveCount(3);
  await section.getByRole('button', {name: /Edit entry 5 Jan 2019/}).click();
  await section.getByRole('button', {name: 'Delete entry', exact: true}).click();
  await expect(rows(section)).toHaveCount(2);

  await page.reload();
  section = await open(page);
  await expect(rows(section)).toHaveCount(2);
  await expect(rows(section).nth(0)).toContainText('70.4');
  await expect(rows(section).nth(1)).toContainText('31 Dec 2018');
  await expect(rows(section).nth(1)).toContainText('68.75');
  await expect(section.getByText('5 Jan 2019')).toHaveCount(0);
});

test('fits the phone and desktop without clipping, with 44px targets, readable labels and keyboard focus', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({width: 412, height: 915});
  await page.goto('/');
  const section = await open(page);
  await add(section, '100.25', '2021-03-04T06:05');
  await add(section, '99.5', '2022-11-20T18:40');
  await add(section, '101.75', '2024-07-01T12:00');
  await page.evaluate(() => document.fonts.ready);

  const panel = page.locator('.settings-panel');
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const sectionBox = (await section.boundingBox())!;
  for (const target of await section.locator('button, input').all()) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(sectionBox.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(sectionBox.x + sectionBox.width + 0.5);
  }
  for (const row of await rows(section).all())
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  const chart = section.getByRole('img', {name: /Body weight over time/});
  await expect.poll(() => renderedLabelSize(chart)).toBeGreaterThanOrEqual(10.99);
  const geometry = await chart.evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    const boxes = [...svg.querySelectorAll('text')].map((label) => label.getBoundingClientRect());
    return {
      contained: boxes.every(
        (b) =>
          b.left >= bounds.left &&
          b.right <= bounds.right &&
          b.top >= bounds.top &&
          b.bottom <= bounds.bottom,
      ),
      overlap: boxes.some((b, i) =>
        boxes
          .slice(i + 1)
          .some(
            (o) => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top,
          ),
      ),
    };
  });
  expect(geometry).toEqual({contained: true, overlap: false});

  // Keyboard: open the form, type, submit with Enter; focus returns with a visible ring.
  const addButton = section.getByRole('button', {name: 'Add weight', exact: true});
  await addButton.focus();
  await page.keyboard.press('Enter');
  const kg = section.getByLabel('Weight in kg', {exact: true});
  await expect(kg).toBeFocused();
  await page.keyboard.type('98');
  await page.keyboard.press('Enter');
  await expect(rows(section)).toHaveCount(4);
  await expect(addButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(addButton).toBeFocused();
  expect(await addButton.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});

test('close two-decimal weights have distinct, contained axis labels', async ({page}) => {
  await page.goto('/');
  const section = await open(page);
  await add(section, '100.01', '2024-07-01T08:00');
  await add(section, '100.02', '2024-07-02T08:00');
  await page.evaluate(() => document.fonts.ready);
  const chart = section.getByRole('img', {name: /Body weight over time/});
  const labels = chart.locator('g text');
  await expect(labels).toHaveCount(3);
  await expect.poll(async () => new Set(await labels.allTextContents()).size).toBe(3);
  const values = (await labels.allTextContents()).map(Number);
  expect(values).toEqual([100.01, 100.015, 100.02]);
  expect(
    await chart.evaluate((svg) => {
      const bounds = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')].every((label) => {
        const box = label.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right;
      });
    }),
  ).toBe(true);
});

test('keyboard Undo returns focus to Add weight after restoring the entry', async ({page}) => {
  await page.goto('/');
  const section = await open(page);
  await add(section, '75.25', '2024-07-01T08:00');
  await section.getByRole('button', {name: /Edit entry/}).focus();
  await page.keyboard.press('Enter');
  await section.getByRole('button', {name: 'Delete entry', exact: true}).focus();
  await page.keyboard.press('Enter');
  const addButton = section.getByRole('button', {name: 'Add weight', exact: true});
  await expect(addButton).toBeFocused();
  const undo = section.getByRole('button', {name: 'Undo', exact: true});
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(rows(section)).toHaveCount(1);
  await expect(undo).toHaveCount(0);
  await expect(addButton).toBeFocused();
  expect(await addButton.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});

test('stale Undo explains the conflict without overwriting the newer entry', async ({page}) => {
  await page.goto('/');
  const section = await open(page);
  await add(section, '75.25', '2024-07-01T08:00');
  await section.getByRole('button', {name: /Edit entry/}).click();
  await section.getByRole('button', {name: 'Delete entry', exact: true}).click();
  await expect(rows(section)).toHaveCount(0);
  // Model a newer entry arriving from another device while the Undo notice is open.
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      const [deleted] = await repository.readBodyWeights();
      await repository.putBodyWeight({...deleted, kg: 76.5, deleted: false}, deleted);
    } finally {
      repository.close();
    }
  });
  await expect(rows(section)).toHaveCount(1);
  const undo = section.getByRole('button', {name: 'Undo', exact: true});
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(section.getByRole('alert')).toHaveText(
    'This entry changed on another device. Undo was not applied; review the latest history below.',
  );
  await expect(rows(section)).toContainText('76.5');
  await expect(undo).toHaveCount(0);
  await expect(section.getByRole('button', {name: 'Add weight', exact: true})).toBeFocused();
  const stored = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      return {
        entries: await repository.readBodyWeights(),
        writes: await repository.db.outbox.count(),
      };
    } finally {
      repository.close();
    }
  });
  expect(stored.entries).toMatchObject([{kg: 76.5, deleted: false}]);
  expect(stored.writes).toBe(3);
});

test('Undo covers one deletion until another edit starts or Settings closes', async ({page}) => {
  await page.goto('/');
  let section = await open(page);
  await add(section, '75.25', '2024-07-01T08:00');
  await add(section, '75.5', '2024-07-02T08:00');
  await section.getByRole('button', {name: /Edit entry 1 Jul 2024/}).click();
  await section.getByRole('button', {name: 'Delete entry', exact: true}).click();
  await expect(section.getByRole('button', {name: 'Undo', exact: true})).toBeVisible();

  // Starting another action consumes the previous Undo, even when that edit is cancelled.
  await section.getByRole('button', {name: /Edit entry 2 Jul 2024/}).click();
  await expect(section.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
  await section.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(rows(section)).toHaveCount(1);
  await section.getByRole('button', {name: /Edit entry 2 Jul 2024/}).click();
  await section.getByRole('button', {name: 'Delete entry', exact: true}).click();
  await section.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(rows(section)).toHaveCount(1);
  await expect(rows(section)).toContainText('2 Jul 2024');

  await section.getByRole('button', {name: /Edit entry/}).click();
  await section.getByRole('button', {name: 'Delete entry', exact: true}).click();
  await page.getByRole('button', {name: 'Close settings'}).click();
  section = await open(page);
  await expect(section.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
  await expect(section.getByText('No entries yet', {exact: false})).toBeVisible();
  await expect(rows(section)).toHaveCount(0);
});

test('phone editors give the native date and time a full-width row', async ({page}) => {
  for (const width of [390, 412]) {
    await page.setViewportSize({width, height: 915});
    await page.goto('/');
    const section = await open(page);
    await section.getByRole('button', {name: 'Add weight', exact: true}).click();
    const kg = (await section.getByLabel('Weight in kg', {exact: true}).boundingBox())!;
    const when = (await section.getByLabel('Date and time', {exact: true}).boundingBox())!;
    expect(when.y).toBeGreaterThanOrEqual(kg.y + kg.height);
    expect(Math.abs(when.x - kg.x)).toBeLessThan(1);
    expect(Math.abs(when.width - kg.width)).toBeLessThan(1);
  }
});

test('read-only follower tabs show entries but cannot change them', async ({page, context}) => {
  await page.goto('/');
  await add(await open(page), '80.5', '2022-02-02T08:00');
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.getByRole('alert').first()).toContainText('Another tab is editing');
  await openSettings(follower);
  const section = follower.getByRole('region', {name: 'Body weight', exact: true});
  await expect(rows(section)).toHaveCount(1);
  await expect(section.getByRole('button', {name: 'Add weight', exact: true})).toBeDisabled();
  await expect(section.getByRole('button', {name: /Edit entry/})).toBeDisabled();
});

test('a locked installation hides body-weight history and refuses writes', async ({page}) => {
  let revoked = false;
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().url().endsWith('/session')) {
      if (revoked) return route.fulfill({status: 401, json: {}});
      return route.fulfill({json: {ownerId: 'owner', csrfToken: 'synthetic-csrf'}});
    }
    if (route.request().url().includes('/sync/operations'))
      return route.fulfill({
        json: {
          results: (
            route.request().postDataJSON() as {
              operations: {
                operationId: string;
                entityId: string;
                expectedRevision: number | null;
              }[];
            }
          ).operations.map((o) => ({
            operationId: o.operationId,
            entityId: o.entityId,
            status: 'accepted',
            revision: (o.expectedRevision ?? 0) + 1,
            changeSeq: 1,
          })),
        },
      });
    return route.fulfill({json: {changes: [], nextCursor: 0, hasMore: false}});
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await add(await open(page), '75.5', '2022-02-02T08:00');
  await page.getByRole('button', {name: 'Close settings'}).click();
  revoked = true;
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    await repository.db.meta.put({key: 'local-trust', value: false});
    repository.close();
  });
  await expect(page.locator('main')).toBeHidden();
  await openSettings(page);
  const settings = page.getByRole('dialog', {name: 'Settings'});
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('region', {name: 'Body weight', exact: true})).toHaveCount(0);
  await expect(settings.getByText('75.5')).toHaveCount(0);
  const refused = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      await repository.putBodyWeight(
        {id: 'locked-probe', date: '2022-02-03T08:00:00', kg: 70, deleted: false},
        null,
      );
      return 'written';
    } catch (error) {
      return String(error);
    } finally {
      repository.close();
    }
  });
  expect(refused).toContain('Reconnect');
});
