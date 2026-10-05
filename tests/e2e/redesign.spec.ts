import {expect, test} from '@playwright/test';

import {addExercise, navigate} from '../navigation';

test('workout sheet minimizes to a named resume bar preserving the draft and ledger scroll', async ({
  page,
}, info) => {
  await page.goto('/?demo=1');
  const sheet = page.getByRole('region', {name: 'Active workout'});
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  if (info.project.name === 'mobile') {
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(390);
    expect(box.height).toBe(844);
    await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeHidden();
    expect(await page.locator('.library').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  } else {
    expect(box.width).toBe(500);
    await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeVisible();
  }
  await page
    .getByLabel(/Weight for .* set 1/)
    .first()
    .fill('42.5');
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.locator('.workout-scroll').evaluate((el) => {
    el.scrollTop = 320;
  });
  const scroll = await page.locator('.workout-scroll').evaluate((el) => el.scrollTop);
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeVisible();
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await page.getByRole('button', {name: /Resume Upper body A/}).click();
  await expect(page.getByLabel(/Weight for .* set 1/).first()).toHaveValue('42.5');
  await expect(page.getByRole('button', {name: /Uncomplete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.locator('.workout-scroll').evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.reload();
  await expect(page.getByLabel(/Weight for .* set 1/).first()).toHaveValue('42.5');
});

test('numeric entry selects the target and Enter moves weight to reps then explicitly completes', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  const reps = page.getByLabel(/Reps for .* set 1/).first();
  await expect(weight).toBeEditable();
  await weight.focus();
  await expect(weight).toBeFocused();
  await page.keyboard.type('55');
  await expect(weight).toHaveValue('55');
  await weight.press('Enter');
  await expect(reps).toBeFocused();
  await page.keyboard.type('9');
  await expect(reps).toHaveValue('9');
  await reps.press('Enter');
  await expect(page.getByRole('button', {name: /Uncomplete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await reps.fill('3.5');
  await reps.press('Enter');
  await expect(page.getByRole('button', {name: /Complete .* set 1/}).first()).toBeDisabled();
  await reps.fill('1001');
  await reps.press('Enter');
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
});

test('five-column Previous opens evidence for the selected set weight and source workout', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const exercise = page.locator('.exercise-card').first();
  await expect(exercise.locator('.set-head')).toContainText('Previous');
  // The open five-column sheet must not scroll sideways on any viewport.
  expect(
    await page
      .locator('.workout-scroll')
      .evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth,
      ),
  ).toBe(true);
  const second = exercise.locator('.set-row:not(.set-head)').nth(1);
  await second.getByLabel(/Weight/).fill('60');
  await second.getByRole('button', {name: /Previous for .* set 2/}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Best at 60 kg');
  await expect(dialog).toContainText('Previous session');
  await expect(dialog.getByRole('button', {name: /View source workout/}).first()).toBeVisible();
  await dialog
    .getByRole('button', {name: /View source workout/})
    .first()
    .click();
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  await expect(page.locator('.focused-history .recorded-sets').first()).toContainText(
    '60 kg × 9 reps',
  );
  await page.getByRole('button', {name: /Resume Upper body A/}).click();
  await second.getByLabel(/Weight/).fill('61');
  await second.getByRole('button', {name: /Previous for .* set 2/}).click();
  await expect(dialog).toContainText('No exact-weight history');
  await expect(dialog).toContainText('No equivalent performance is inferred');
  await dialog.getByRole('button', {name: 'Close previous sets'}).click();
  await expect(second.getByLabel(/Weight/)).toHaveValue('61');
});

test('exercise Done requires every valid set checked and returns to targets on edit or add', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const exercise = page.locator('.exercise-card').first();
  await expect(exercise.getByRole('status', {name: 'Exercise completion'})).toHaveText(
    '0 / 3 sets',
  );
  for (let set = 1; set <= 3; set++)
    await exercise.getByRole('button', {name: new RegExp(`^Complete .* set ${set}$`)}).click();
  await expect(exercise.getByRole('status', {name: 'Exercise completion'})).toHaveText('Done');
  await expect(exercise.locator('.set-complete')).toHaveCount(3);
  await exercise.getByLabel(/Reps/).first().fill('10');
  await expect(exercise.getByRole('status', {name: 'Exercise completion'})).toHaveText(
    '2 / 3 sets',
  );
  await exercise.getByRole('button', {name: /^Complete /}).click();
  await exercise.getByRole('button', {name: 'Add set', exact: true}).click();
  await expect(exercise.getByRole('status', {name: 'Exercise completion'})).toHaveText(
    '3 / 4 sets',
  );
  await expect(exercise.getByRole('button', {name: /Complete .* set 4/})).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

const set = (id: string, weight: number | null, reps: number | null, completed = true) => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  completed,
});
const historical = [
  {
    id: 'older',
    name: 'Exact older session',
    date: '2026-01-01T12:00:00',
    duration: 40,
    exercises: [{name: 'Synthetic Press', type: 'weighted', sets: [set('old', 30, 8)]}],
  },
  {
    id: 'newer',
    name: 'Latest session',
    date: '2026-02-01T12:00:00',
    duration: 40,
    exercises: [
      {
        name: 'Synthetic Press',
        type: 'weighted',
        sets: [set('new-1', 55, 10), set('new-2', 50, 9)],
      },
    ],
  },
];
const routine = {
  id: 'routine',
  name: 'Evidence routine',
  date: '2026-01-01T12:00:00',
  duration: 0,
  exercises: [
    {
      name: 'Synthetic Press',
      type: 'weighted',
      sets: [set('r1', 20, 5, false), set('r2', 20, 5, false), set('r3', 20, 5, false)],
    },
    {name: 'Never logged', type: 'weighted', sets: [set('unknown', 20, 5, false)]},
  ],
};
const seeded = {
  version: 1,
  dataset: {
    sourceLabel: 'Synthetic fixture',
    workouts: historical,
    warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [routine],
};

test('routine starts use actual latest matching history unchecked, else the routine values', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('gym-log:v1', JSON.stringify(value)),
    seeded,
  );
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Open template Evidence routine'}).click();
  await page.getByRole('button', {name: 'Start template Evidence routine'}).click();
  const weights = page.getByLabel(/Weight for Synthetic Press/);
  await expect(weights.nth(0)).toHaveValue('55');
  await expect(weights.nth(1)).toHaveValue('50');
  await expect(weights.nth(2)).toHaveValue('50');
  await expect(page.getByLabel('Reps for Synthetic Press set 3')).toHaveValue('9');
  // No history: the values planned in the routine editor are the targets, still unchecked.
  await expect(page.getByLabel('Weight for Never logged set 1')).toHaveValue('20');
  await expect(page.getByLabel('Reps for Never logged set 1')).toHaveValue('5');
  await expect(page.getByRole('button', {name: /Uncomplete /})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
});

test('added exercises reuse matching history unchecked and custom exercises have blank targets', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('gym-log:v1', JSON.stringify(value)),
    seeded,
  );
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await addExercise(page, 'Synthetic Press');
  await expect(page.getByLabel('Weight for Synthetic Press set 1')).toHaveValue('55');
  await expect(page.getByLabel('Weight for Synthetic Press set 2')).toHaveValue('50');
  await expect(page.getByRole('button', {name: /Uncomplete /})).toHaveCount(0);
  await addExercise(page, 'New custom lift');
  await expect(page.getByLabel(/Weight for New custom lift/)).toHaveCount(3);
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByLabel(`Weight for New custom lift set ${i}`)).toHaveValue('');
    await expect(page.getByLabel(`Reps for New custom lift set ${i}`)).toHaveValue('');
  }
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await page.getByRole('button', {name: /Repeat workout Exact older session/}).click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByLabel('Weight for Synthetic Press set 1')).toHaveValue('30');
  await expect(page.getByLabel('Reps for Synthetic Press set 1')).toHaveValue('8');
  await expect(page.getByLabel(/Weight for Synthetic Press/)).toHaveCount(1);
  await expect(page.getByRole('button', {name: /Uncomplete /})).toHaveCount(0);
});

test('appearance is separate from workout saving, follows System, and persists theme and accent', async ({
  page,
}) => {
  await page.emulateMedia({colorScheme: 'dark'});
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
  const settings = page.getByRole('dialog', {name: 'Settings'});
  await expect(settings.getByRole('button', {name: 'System', exact: true})).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#17161b');
  await page.emulateMedia({colorScheme: 'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await settings.getByRole('button', {name: 'Dark', exact: true}).click();
  await settings.getByRole('button', {name: 'Ocean', exact: true}).click();
  await settings.getByRole('button', {name: 'Close settings'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'ocean');
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Upper body A');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('gym-log:appearance:v1')!)),
  ).toEqual({version: 1, theme: 'dark', accent: 'ocean'});
});

test('a read-only writer follower can still minimize and reach settings and recovery guidance', async ({
  page,
  context,
}) => {
  await page.goto('/?demo=1');
  await expect(page.getByLabel('WORKOUT NAME')).toBeEditable();
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.getByRole('alert')).toContainText('Another tab is editing');
  await expect(follower.getByLabel('WORKOUT NAME')).toBeDisabled();
  await follower.getByRole('button', {name: 'Settings', exact: true}).last().click();
  await expect(follower.getByRole('dialog', {name: 'Settings'})).toBeVisible();
  await expect(follower.getByRole('button', {name: 'Import CSV'})).toBeDisabled();
  await expect(follower.getByRole('button', {name: 'Reload to enable editing'})).toBeEnabled();
  await follower.getByRole('button', {name: 'Close settings'}).click();
  await follower.getByRole('button', {name: 'Minimize workout'}).click();
  await expect(follower.getByRole('navigation', {name: 'Main navigation'})).toBeVisible();
});

test('settings keeps synchronization feedback accessible without duplicate hidden statuses', async ({
  page,
}) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/session')
        ? {ownerId: 'owner', csrfToken: 'synthetic'}
        : {changes: [], nextCursor: 0, hasMore: false},
    }),
  );
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
  await expect(page.getByRole('button', {name: 'Sync now', exact: true})).toHaveCount(0);
  await expect(page.getByText('Synced', {exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Close settings'}).click();
  await expect(page.getByRole('button', {name: 'Settings', exact: true}).last()).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sync', 'Synced');
});

test('denied appearance storage leaves workout durability independent and the choice usable in this tab', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem,
      put = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'gym-log:appearance:v1') throw new DOMException('Denied', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gym-log:appearance:v1') throw new DOMException('Denied', 'SecurityError');
      return put.call(this, key, value);
    };
  });
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
  await page.getByRole('button', {name: 'Copper', exact: true}).click();
  await expect(
    page.getByRole('status').filter({hasText: 'Appearance could not be saved.'}),
  ).toContainText('Workout saving is separate');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'copper');
  await page.getByRole('button', {name: 'Close settings'}).click();
  await page
    .getByLabel(/Weight for .* set 1/)
    .first()
    .fill('47.5');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(page.getByText('Not saved', {exact: true})).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'pine');
  await expect(page.getByLabel(/Weight for .* set 1/).first()).toHaveValue('47.5');
});

test('a saved dark theme applies before the app script runs, so dark phones do not flash light', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'gym-log:appearance:v1',
      JSON.stringify({version: 1, theme: 'dark', accent: 'copper'}),
    ),
  );
  // Without the app bundle only the pre-paint document can set the theme.
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-accent', 'copper');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#17161b');
});

test('swiping left from the Previous column reveals Delete without opening evidence', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'mobile');
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?demo=1`);
  const row = page.locator('.set-row:not(.set-head)').first();
  const previous = row.getByRole('button', {name: /Previous for .* set 1/});
  await expect(previous).toBeEnabled();
  const box = (await previous.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const point = (x: number, y: number) => [{x, y, id: 1}];
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: point(x, y)});
  for (let step = 1; step <= 8; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(x - step * 15, y),
    });
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(row.getByRole('button', {name: /^Delete /})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});
