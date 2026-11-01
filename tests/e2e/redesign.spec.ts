import {expect, test} from '@playwright/test';

import {addExercise, navigate, openSettings, openWorkout, shownText} from '../navigation';
import {resolve} from './colour-helpers';

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
  const resume = page.getByRole('button', {name: /Resume Upper body A/});
  await expect(resume.locator('.live-dot')).toBeVisible();
  await resume.click();
  if (info.project.name === 'mobile') {
    // The sheet slides back up over the library and settles flush with the screen.
    await expect(sheet).toHaveAttribute('data-motion');
    await expect.poll(async () => (await sheet.boundingBox())!.y).toBe(0);
  }
  await expect(page.getByLabel(/Weight for .* set 1/).first()).toHaveValue('42.5');
  await expect(page.getByRole('button', {name: /Uncomplete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.locator('.workout-scroll').evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.reload();
  await expect(page.getByLabel(/Weight for .* set 1/).first()).toHaveValue('42.5');
});

test('a set value is replaced by the first digit without selecting text', async ({page}) => {
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  const reps = page.getByLabel(/Reps for .* set 1/).first();
  await expect(weight).toBeEditable();
  const before = await weight.inputValue();
  expect(before).not.toBe('');
  await weight.click();
  await expect(weight).toBeFocused();
  // A selection would open the phone's native Cut/Copy/Select all menu.
  expect(await weight.evaluate((el: HTMLInputElement) => el.matches('[data-replacing]'))).toBe(
    true,
  );
  await page.waitForTimeout(100);
  expect(
    await weight.evaluate((el: HTMLInputElement) => {
      el.type = 'text';
      const collapsed = el.selectionStart === el.selectionEnd;
      el.type = 'number';
      return collapsed;
    }),
  ).toBe(true);
  await expect(weight).toHaveValue(before);
  // Leaving untouched keeps the value.
  await reps.click();
  await expect(weight).toHaveValue(before);
  await page.keyboard.type('7');
  await expect(reps).toHaveValue('7');
  await page.keyboard.type('5');
  await expect(reps).toHaveValue('75');
  // Backspace edits the value instead of replacing it.
  await weight.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(weight).toHaveValue(before.slice(0, -1));
  // A keyboard that appends a digit without a plain insertText beforeinput still replaces.
  await reps.click();
  await reps.evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, el.value + '8');
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await expect(reps).toHaveValue('8');
  // A decimal typed key by key replaces on the first digit, then appends.
  await weight.click();
  await page.keyboard.type('62.5');
  await expect(weight).toHaveValue('62.5');
  // The fallback compares against the field's text, not the stored number.
  await reps.fill('080');
  await weight.click();
  await reps.click();
  await reps.evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, el.value + '5');
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await expect(reps).toHaveValue('5');
});

test('numeric entry replaces the target and Enter moves weight to reps then explicitly completes', async ({
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
  // An invalid value on a ticked set drops the tick; Enter cannot re-tick it.
  await reps.fill('3.5');
  await reps.press('Enter');
  await expect(
    page
      .locator('.exercise-card')
      .first()
      .getByRole('button', {name: /Uncomplete .* set 1$/}),
  ).toHaveCount(0);
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
  await expect(dialog).toContainText(/60 kg × \d+ · \d/);
  await expect(dialog).toContainText('Previous session');
  await expect(dialog.getByRole('button', {name: /View source workout/}).first()).toBeVisible();
  await dialog
    .getByRole('button', {name: /View source workout/})
    .first()
    .click();
  // The source workout opens in its drawer over History.
  await expect(page.locator('.library-scroll h1')).toHaveText('History');
  const drawer = page.locator('.workout-drawer');
  await expect(drawer.locator('.recorded-sets').first()).toContainText('60 kg × 9');
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.focused-history button')).toBeFocused();
  await page.getByRole('button', {name: /Resume Upper body A/}).click();
  await second.getByLabel(/Weight/).fill('61');
  await second.getByRole('button', {name: /Previous for .* set 2/}).click();
  await expect(dialog).toContainText('No counted sets at 61 kg');
  await expect(dialog).toContainText('No equivalent performance is inferred');
  await dialog.getByRole('button', {name: 'Close previous sets'}).click();
  await expect(second.getByLabel(/Weight/)).toHaveValue('61');
});

test('an unrecorded weight shows the nearest actual lighter and heavier sets with sources', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const second = page.locator('.exercise-card').first().locator('.set-row:not(.set-head)').nth(1);
  await second.getByLabel(/Weight/).fill('61');
  await second.getByRole('button', {name: /Previous for .* set 2/}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('No counted sets at 61 kg');
  const nearest = dialog.getByRole('region', {name: 'Nearest recorded'});
  await expect(nearest).toContainText('actual sets');
  const lighter = nearest.getByRole('listitem').filter({hasText: 'Lighter'});
  const heavier = nearest.getByRole('listitem').filter({hasText: 'Heavier'});
  await expect(lighter).toContainText(/60 kg × 9 · \d/);
  await expect(heavier).toContainText(/62\.5 kg × 8 · \d/);
  const view = heavier.getByRole('button', {name: /View source workout/});
  // Measured once the open animation has settled (it zooms in from 95%).
  await expect.poll(async () => (await view.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Nothing in the sheet may scroll sideways on a phone.
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', {name: 'Close previous sets'}).click();
  // A blank weight is not a claim about history.
  await second.getByLabel(/Weight/).fill('');
  await second.getByRole('button', {name: /Previous for .* set 2/}).click();
  await expect(dialog).toContainText('Enter a weight to compare');
  await expect(dialog).not.toContainText('sets at');
  await dialog.getByRole('button', {name: 'Close previous sets'}).click();
  await second.getByLabel(/Weight/).fill('61');
  await second.getByRole('button', {name: /Previous for .* set 2/}).click();
  await view.click();
  await expect(page.locator('.library-scroll h1')).toHaveText('History');
  await expect(page.locator('.workout-drawer .recorded-sets').first()).toContainText('62.5 kg × 8');
});

test('exercise Done survives value edits and reload but a new set needs its own tick', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const exercise = page.locator('.exercise-card').first();
  const progress = page.locator('.workout-progress');
  const meta = page.locator('.workout-meta');
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('0 / 3 sets');
  await expect(progress).toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)');
  await expect(exercise.locator('.exercise-badge')).toHaveCSS('opacity', '0');
  // Count the heading's done flash: it plays once, when the exercise's last set is checked.
  await page.evaluate(() => {
    const flashes: string[] = [];
    (window as unknown as {flashes: string[]}).flashes = flashes;
    document.addEventListener('animationstart', (event) => flashes.push(event.animationName), true);
  });
  for (let set = 1; set <= 3; set++) {
    await exercise.getByRole('button', {name: new RegExp(`^Complete .* set ${set}$`)}).click();
    await expect(
      exercise
        .locator('.set-row:not(.set-head)')
        .nth(set - 1)
        .locator('.check-box'),
    ).toHaveAttribute('data-done');
  }
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('Done');
  await expect(exercise.locator('.set-complete')).toHaveCount(3);
  await expect(exercise.locator('.exercise-badge')).toHaveCSS('opacity', '1');
  await expect
    .poll(() => page.evaluate(() => [...(window as unknown as {flashes: string[]}).flashes].sort()))
    .toEqual(['check-pop', 'check-pop', 'check-pop', 'done-flash']);
  // The header's progress bar fills by the share of checked sets.
  const [done, total] = (await shownText(meta)).match(/\d+/g)!.map(Number);
  expect(done).toBe(3);
  await expect
    .poll(() => progress.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBeCloseTo(3 / total, 3);
  const weight = exercise.getByLabel(/Weight/).first();
  const reps = exercise.getByLabel(/Reps/).first();
  const tick = exercise.getByRole('button', {name: /Uncomplete .* set 1/});
  await weight.fill('67.5');
  await expect(tick).toHaveAttribute('aria-pressed', 'true');
  await reps.fill('10');
  await expect(tick).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('Done');
  // A blank or invalid value unticks the set; a valid value afterwards needs a fresh tick.
  await reps.fill('');
  await expect(tick).toHaveCount(0);
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('2 / 3 sets');
  await reps.fill('10');
  await expect(exercise.getByRole('button', {name: /^Complete .* set 1$/})).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await exercise.getByRole('button', {name: /^Complete .* set 1$/}).click();
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('Done');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(weight).toHaveValue('67.5');
  await expect(reps).toHaveValue('10');
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('Done');
  await tick.click();
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('2 / 3 sets');
  await exercise.getByRole('button', {name: /^Complete /}).click();
  await exercise.getByRole('button', {name: 'Add set', exact: true}).click();
  await expect
    .poll(() => shownText(exercise.getByRole('status', {name: 'Exercise completion'})))
    .toBe('3 / 4 sets');
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
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [routine],
};

test('routine starts use actual latest matching history unchecked, else the routine values', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('ember:v1', JSON.stringify(value)),
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

test('added exercises reuse matching history unchecked and unlogged catalog exercises have blank targets', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('ember:v1', JSON.stringify(value)),
    seeded,
  );
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await addExercise(page, 'Synthetic Press');
  await expect(page.getByLabel('Weight for Synthetic Press set 1')).toHaveValue('55');
  await expect(page.getByLabel('Weight for Synthetic Press set 2')).toHaveValue('50');
  await expect(page.getByRole('button', {name: /Uncomplete /})).toHaveCount(0);
  await addExercise(page, 'Bench Press (Barbell)');
  await expect(page.getByLabel(/Weight for Bench Press \(Barbell\)/)).toHaveCount(3);
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByLabel(`Weight for Bench Press (Barbell) set ${i}`)).toHaveValue('');
    await expect(page.getByLabel(`Reps for Bench Press (Barbell) set ${i}`)).toHaveValue('');
  }
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await openWorkout(page, 'Exact older session');
  await page.getByRole('button', {name: /Repeat workout Exact older session/}).click();
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByLabel('Weight for Synthetic Press set 1')).toHaveValue('30');
  await expect(page.getByLabel('Reps for Synthetic Press set 1')).toHaveValue('8');
  await expect(page.getByLabel(/Weight for Synthetic Press/)).toHaveCount(1);
  await expect(page.getByRole('button', {name: /Uncomplete /})).toHaveCount(0);
});

test('appearance is separate from workout saving, follows System, and persists theme', async ({
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
  await settings.getByRole('button', {name: 'Close settings'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Upper body A');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ember:appearance:v1')!)),
  ).toEqual({version: 1, theme: 'dark'});
});

test('sounds and haptics start on, play when a workout starts and each switch persists on this device', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const record = window as unknown as {vibrations: number[][]; audioContexts: number};
    record.vibrations = [];
    record.audioContexts = 0;
    navigator.vibrate = (pattern) => {
      record.vibrations.push(typeof pattern === 'number' ? [pattern] : [...pattern]);
      return true;
    };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        record.audioContexts++;
      }
    };
  });
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/session')
        ? {ownerId: 'owner', csrfToken: 'synthetic'}
        : {changes: [], nextCursor: 0, hasMore: false},
    }),
  );
  const cues = () =>
    page.evaluate(() => {
      const record = window as unknown as {vibrations: number[][]; audioContexts: number};
      return {vibrations: record.vibrations, audioContexts: record.audioContexts};
    });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  expect(await cues()).toEqual({vibrations: [[18, 60, 10]], audioContexts: 1});
  // Typing plays nothing; each check climbs, the exercise's last check chimes, an untick drops.
  await addExercise(page, 'Squat (Barbell)');
  for (const set of [1, 2, 3]) {
    await page.getByLabel(`Weight for Squat (Barbell) set ${set}`).fill('100');
    await page.getByLabel(`Reps for Squat (Barbell) set ${set}`).fill('5');
  }
  expect((await cues()).vibrations).toEqual([[18, 60, 10]]);
  for (const set of [1, 2, 3])
    await page.getByRole('button', {name: `Complete Squat (Barbell) set ${set}`}).click();
  await expect
    .poll(async () => (await cues()).vibrations)
    .toEqual([[18, 60, 10], [12], [12], [12], [12, 50, 18]]);
  await page.getByRole('button', {name: 'Uncomplete Squat (Barbell) set 1'}).click();
  // Opening ⋯ ticks.
  await page.locator('button[aria-label="Exercise options for Squat (Barbell)"]').click();
  await expect
    .poll(async () => (await cues()).vibrations)
    .toEqual([[18, 60, 10], [12], [12], [12], [12, 50, 18], [6], [6]]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await openSettings(page);
  const settings = page.getByRole('dialog', {name: 'Settings', exact: true});
  const feedback = settings.getByRole('region', {name: 'Feedback'});
  const sounds = feedback.getByRole('switch', {name: 'Sounds'});
  const haptics = feedback.getByRole('switch', {name: 'Haptics'});
  await expect(sounds).toHaveAttribute('aria-checked', 'true');
  await expect(sounds).toHaveAccessibleDescription('Short, quiet cues. They mix with your music.');
  await expect(haptics).toHaveAttribute('aria-checked', 'true');
  for (const control of [sounds, haptics])
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await haptics.click();
  await expect(haptics).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ember:feedback:v1')!))).toEqual(
    {version: 1, sound: true, haptics: false},
  );

  await page.reload();
  await openSettings(page);
  await expect(haptics).toHaveAttribute('aria-checked', 'false');
  await expect(sounds).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('button', {name: 'Close settings'}).click();
  await page.getByRole('button', {name: 'Cancel workout'}).click();
  await page.getByRole('button', {name: 'Discard workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  // Haptics off: the start cue only plays its sound.
  expect(await cues()).toEqual({vibrations: [], audioContexts: 1});
});

test('a read-only writer follower can minimize and reach settings and recovery guidance', async ({
  page,
  context,
}) => {
  await page.goto('/?demo=1');
  await expect(page.getByLabel('WORKOUT NAME')).toBeEditable();
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.getByRole('alert')).toContainText('Another tab is editing');
  await expect(follower.getByLabel('WORKOUT NAME')).toBeDisabled();
  await expect(follower.getByLabel('WORKOUT NAME')).toHaveCSS(
    'background-color',
    await resolve(follower, 'hsl(37.1 36.8% 88.8%)'),
  );
  await follower.getByRole('button', {name: 'Settings', exact: true}).last().click();
  await expect(follower.getByRole('dialog', {name: 'Settings'})).toBeVisible();
  await expect(follower.getByRole('button', {name: 'Add weight'})).toBeDisabled();
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
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
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
      if (key === 'ember:appearance:v1') throw new DOMException('Denied', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ember:appearance:v1') throw new DOMException('Denied', 'SecurityError');
      return put.call(this, key, value);
    };
  });
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.getByRole('button', {name: 'Settings', exact: true}).last().click();
  await page.getByRole('button', {name: 'Dark', exact: true}).click();
  await expect(
    page.getByRole('status').filter({hasText: 'Appearance could not be saved.'}),
  ).toContainText('Workout saving is separate');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', {name: 'Close settings'}).click();
  await page
    .getByLabel(/Weight for .* set 1/)
    .first()
    .fill('47.5');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(page.getByText('Not saved', {exact: true})).toHaveCount(0);
  await page.emulateMedia({colorScheme: 'light'});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel(/Weight for .* set 1/).first()).toHaveValue('47.5');
});

test('a saved dark theme applies before the app script runs, so dark phones do not flash light', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'ember:appearance:v1',
      JSON.stringify({version: 1, theme: 'dark', accent: 'copper'}),
    ),
  );
  // Without the app bundle only the pre-paint document can set the theme.
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
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

test('active exercise headers show the name and set completion for every exercise type', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const sheet = page.getByRole('region', {name: 'Active workout'});
  await expect(
    sheet.getByRole('heading', {name: 'Bench Press (Barbell)', exact: true}),
  ).toBeVisible();
  await addExercise(page, 'Pull Up');
  await addExercise(page, 'Plank');
  await addExercise(page, 'Rowing (Machine)');
  const headings = sheet.locator('.exercise-heading');
  await expect(headings).toHaveCount(8);
  for (const heading of await headings.all()) {
    await expect(heading.getByRole('heading')).toHaveText(/\S/);
    await expect
      .poll(() => shownText(heading.getByRole('status', {name: 'Exercise completion'})))
      .toMatch(/^0 \/ \d+ sets?$/);
  }
});

test('each set has a labelled completion button centred in the last set-table column', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const sheet = page.getByRole('region', {name: 'Active workout'});
  const heads = sheet.locator('.set-head');
  await expect(heads.first()).toContainText('Reps');
  const check = sheet.getByRole('button', {name: /^Complete .* set 1$/}).first();
  await expect(check).toBeVisible();
  const column = (await heads.first().locator('span').nth(4).boundingBox())!;
  const button = (await check.boundingBox())!;
  expect(Math.abs(column.x + column.width / 2 - (button.x + button.width / 2))).toBeLessThan(4);
});
