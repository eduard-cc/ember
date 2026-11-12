import {type Page, expect, test} from '@playwright/test';

import {navigate, openWorkout, workoutAction, workoutCard} from '../navigation';

// Synthetic fixture only.
const set = (id: string, weight: number, reps: number) => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  original: {Weight: String(weight), 'Weight Unit': 'kg', Reps: String(reps)},
});
const seeded = {
  version: 1,
  dataset: {
    sourceLabel: 'Synthetic fixture',
    workouts: [
      {
        id: 'later',
        name: 'Push day',
        date: '2026-02-01T12:00:00',
        duration: 40,
        exercises: [{name: 'Synthetic Press', type: 'weighted', sets: [set('p1', 50, 5)]}],
      },
      {
        id: 'earlier',
        name: 'Pull day',
        date: '2026-01-01T12:00:00',
        duration: 35,
        exercises: [{name: 'Synthetic Row', type: 'weighted', sets: [set('r1', 30, 10)]}],
      },
    ],
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [],
};

const open = async (page: Page, value = seeded) => {
  await page.addInitScript(
    (value) => localStorage.setItem('ember:v1', JSON.stringify(value)),
    value,
  );
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'History');
};

const stored = (page: Page) =>
  page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      return {state: await repository.readState(), outbox: await repository.db.outbox.toArray()};
    } finally {
      repository.close();
    }
  });

test('a history workout edited from its drawer returns to the drawer, and the edit survives a reload @dev-server', async ({
  page,
}) => {
  const value = structuredClone(seeded);
  // Enough sets that the drawer scrolls, so returning to it can be checked in place.
  value.dataset.workouts[0].exercises.push({
    name: 'Synthetic Press',
    type: 'weighted',
    sets: Array.from({length: 12}, (_, i) => set(`p${i + 2}`, 55, 7)),
  });
  await open(page, value);
  const drawer = await openWorkout(page, 'Push day');
  const body = drawer.locator('.workout-drawer-body');
  await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const scrolled = await body.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  const options = drawer.getByRole('button', {name: /^Workout options for Push day/});
  await options.click();
  await page.getByRole('menuitem', {name: 'Edit workout'}).click();
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await expect(editor).toBeVisible();
  // The editor sits on the drawer: its dismiss control goes back to it, where it was.
  await expect(editor.getByRole('button', {name: 'Close workout editor'})).toHaveCount(0);
  await editor.getByRole('button', {name: 'Back to workout'}).click();
  await expect(editor).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(options).toBeFocused();
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrolled);

  // With nothing changed, Save just closes back to the drawer.
  await options.click();
  await page.getByRole('menuitem', {name: 'Edit workout'}).click();
  const save = editor.getByRole('button', {name: 'Save changes'});
  await expect(save).toHaveText('Save');
  await save.click();
  await expect(editor).toBeHidden();
  await expect(options).toBeFocused();

  await options.click();
  await page.getByRole('menuitem', {name: 'Edit workout'}).click();
  // Previous is the session before this one; the workout's own sets are not evidence.
  await expect(
    editor.getByRole('button', {name: 'Previous for Synthetic Press set 1'}).first(),
  ).toHaveText('—');
  await expect(editor.locator('.editor-meta')).toHaveText(
    'Sun, 1 Feb 2026 · 2 exercises · 13 sets',
  );
  await editor.getByLabel('Workout name').fill('Heavy push');
  await editor.getByLabel('Duration (min)').fill('55');
  await expect(editor.getByLabel('Start', {exact: true})).toHaveAttribute('type', 'datetime-local');
  await editor.getByLabel('Start', {exact: true}).fill('2026-02-01T13:45');
  const reps = editor.getByLabel('Reps for Synthetic Press set 1').first();
  const weight = editor.getByLabel('Weight for Synthetic Press set 1').first();
  await reps.fill('6');
  // A changed value is marked, and its exercise counts it.
  await expect(reps).toHaveClass(/edited-field/);
  await expect(weight).not.toHaveClass(/edited-field/);
  await expect(editor.locator('.exercise-card').first().locator('.exercise-meta')).toContainText(
    '1 changed',
  );
  // Clearing a value blocks saving with a reason instead of storing a broken set.
  await weight.fill('');
  await save.click();
  await expect(editor.getByRole('alert')).toContainText('Fill in the new or changed set');
  await expect(editor.getByRole('alert')).toBeFocused();
  await expect(editor).toBeVisible();
  await weight.fill('52.5');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await save.click();
  // A save returns to the drawer, showing the saved workout.
  await expect(editor).toBeHidden();
  await expect(drawer.getByRole('heading', {name: 'Heavy push'})).toBeVisible();
  await expect(drawer).toContainText('55 min');
  await expect(drawer.locator('.recorded-sets').first()).toContainText('52.5 kg × 6');
  await expect(drawer.getByRole('button', {name: /^Workout options for Heavy push/})).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await drawer.getByRole('button', {name: 'Close workout'}).click();
  await expect(drawer).toBeHidden();
  await expect(workoutCard(page, 'Heavy push')).toBeFocused();
  const saved = (await stored(page)).state.dataset!.workouts.find(
    (w: {id: string}) => w.id === 'later',
  );
  expect(saved).toMatchObject({
    id: 'later',
    name: 'Heavy push',
    date: '2026-02-01T13:45:00',
    duration: 55,
  });
  expect(saved.exercises).toHaveLength(2);
  expect(saved.exercises[0].sets[0]).toMatchObject({
    id: 'p1',
    original: value.dataset.workouts[0].exercises[0].sets[0].original,
  });
  expect(saved.exercises[1]).toEqual(value.dataset.workouts[0].exercises[1]);

  await page.reload();
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'Heavy push'})).toBeVisible();
  await expect(page.locator('.history-card').first()).toContainText('55 min');
  const reopened = await openWorkout(page, 'Heavy push');
  await expect(reopened.locator('.recorded-sets')).toContainText(['52.5 kg × 6', '55 kg × 7']);
  await expect(reopened).toContainText('55 min');
});

test('cancelling an edited workout asks before discarding @dev-server', async ({page}) => {
  await open(page);
  const before = await stored(page);
  await workoutAction(page, 'Pull day', 'Edit workout');
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await editor.getByLabel('Workout name').fill('Changed');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', {name: 'Discard changes?'});
  await expect(discard).toHaveAccessibleDescription('Your edits to Pull day will be lost.');
  // The safe choice has focus, and keeping returns to the field in use.
  await expect(discard.getByRole('button', {name: 'Keep editing'})).toBeFocused();
  await discard.getByRole('button', {name: 'Keep editing'}).click();
  await expect(discard).toBeHidden();
  await expect(editor.getByLabel('Workout name')).toHaveValue('Changed');
  await expect(editor.getByLabel('Workout name')).toBeFocused();
  await editor.getByRole('button', {name: 'Back to workout'}).click();
  await discard.getByRole('button', {name: 'Discard changes'}).click();
  await expect(editor).toBeHidden();
  await expect(
    page.locator('.workout-drawer').getByRole('heading', {name: 'Pull day'}),
  ).toBeVisible();
  expect(await stored(page)).toEqual(before);
});

for (const dismissal of ['Back button', 'Escape']) {
  test(`${dismissal} on a long changed workout asks before discarding, with Save always in reach`, async ({
    page,
  }) => {
    const long = structuredClone(seeded);
    long.dataset.workouts[0].exercises = Array.from({length: 8}, (_, i) => ({
      name: `Synthetic exercise ${i + 1}`,
      type: 'weighted',
      sets: Array.from({length: 4}, (_, j) => set(`long-${i}-${j}`, 40, 8)),
    }));
    await open(page, long);
    await workoutAction(page, 'Push day', 'Edit workout');
    const editor = page.getByRole('dialog', {name: 'Edit workout'});
    const save = editor.getByRole('button', {name: 'Save changes'});
    await expect(save).toBeInViewport({ratio: 1});
    await expect(editor.getByRole('heading', {name: 'Edit workout'})).toBeFocused();
    await expect(editor.locator('.editor-meta')).toContainText('8 exercises · 32 sets');
    await editor.getByLabel('Workout name').fill('Unsaved name');
    const last = editor.getByLabel('Reps for Synthetic exercise 8 set 4');
    await last.fill('9');
    if (dismissal === 'Escape') {
      const reachable = async () => {
        await expect(save).toBeInViewport({ratio: 1});
        const field = (await last.boundingBox())!;
        const panel = (await editor.boundingBox())!;
        expect(field.y + field.height).toBeLessThanOrEqual(panel.y + panel.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          page.viewportSize()!.width,
        );
      };
      for (const size of [
        {width: 320, height: 740},
        {width: 740, height: 320},
        {width: 412, height: 390},
      ]) {
        await page.setViewportSize(size);
        await last.focus();
        await expect(async () => reachable()).toPass();
      }
      await page.setViewportSize({width: 412, height: 915});
      await page.evaluate(() => {
        Object.defineProperties(window.visualViewport!, {
          height: {configurable: true, value: 390},
          offsetTop: {configurable: true, value: 40},
        });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect
        .poll(async () => {
          const box = (await editor.boundingBox())!;
          return [Math.round(box.y), Math.round(box.height)];
        })
        .toEqual([40, 390]);
      await last.focus();
      await expect(async () => reachable()).toPass();
      await page.evaluate(() => {
        Reflect.deleteProperty(window.visualViewport!, 'height');
        Reflect.deleteProperty(window.visualViewport!, 'offsetTop');
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
    }
    await expect(save).toBeInViewport({ratio: 1});
    const backButton = editor.getByRole('button', {name: 'Back to workout'});
    await expect(backButton).toBeInViewport({ratio: 1});
    const dismiss = async () => {
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await backButton.click();
    };
    await dismiss();
    const prompt = page.getByRole('dialog', {name: 'Discard changes?'});
    await expect(prompt.getByRole('button', {name: 'Discard changes'})).toBeInViewport({
      ratio: 1,
    });
    // The keyboard lands on the safe option, and keeping returns to the field in use.
    await expect(prompt.getByRole('button', {name: 'Keep editing'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prompt).toBeHidden();
    await expect(last).toBeFocused();
    await expect(last).toHaveValue('9');
    await expect(editor.getByLabel('Workout name')).toHaveValue('Unsaved name');
    await dismiss();
    await prompt.getByRole('button', {name: 'Discard changes'}).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('heading', {name: 'Push day'}).first()).toBeVisible();
  });
}

test('history editing saves added, replaced and reordered exercises with their own fields', async ({
  page,
}) => {
  await open(page);
  await workoutAction(page, 'Push day', 'Edit workout');
  const editor = page.locator('.history-editor');
  const options = (name: string) =>
    editor.getByRole('button', {name: `Exercise options for ${name}`, exact: true});
  await options('Synthetic Press').click();
  // Escape reaches the menu once it has taken focus.
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options('Synthetic Press')).toBeFocused();
  await expect(page.getByRole('dialog', {name: 'Discard changes?'})).toHaveCount(0);
  await editor.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const add = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await expect(add.getByText('To: Push day', {exact: true})).toBeVisible();
  await add.getByLabel('Search exercises').fill('Synthetic Press');
  const existing = add.getByRole('button', {name: 'Synthetic Press', exact: true});
  await expect(existing).toContainText('Already in workout');
  await existing.click();
  await expect(page.locator('[data-sonner-toast] [data-title]')).toHaveText(
    'Synthetic Press is already in this workout.',
  );
  await add.getByLabel('Search exercises').fill('Plank');
  await add
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name: 'Plank', exact: true})
    .click();
  await editor.getByLabel('Seconds for Plank set 1').fill('60');
  // An added exercise's sets count as added.
  await expect(
    editor.locator('.exercise-card', {hasText: 'Plank'}).locator('.exercise-meta'),
  ).toContainText('1 added');
  await options('Synthetic Press').click();
  // Escape reaches the menu once it has taken focus.
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options('Synthetic Press')).toBeFocused();
  await expect(page.getByRole('dialog', {name: 'Discard changes?'})).toHaveCount(0);
  await options('Synthetic Press').click();
  await page.getByRole('menuitem', {name: 'Replace exercise', exact: true}).click();
  const replace = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await expect(replace.getByText('Replacing: Synthetic Press', {exact: true})).toBeVisible();
  await replace.getByLabel('Search exercises').fill('Plank');
  await expect(replace.getByRole('button', {name: 'Plank', exact: true})).toContainText(
    'Already in workout',
  );
  await replace.getByRole('button', {name: 'Plank', exact: true}).click();
  await expect(page.locator('[data-sonner-toast] [data-title]')).toHaveText(
    'Plank is already in this workout.',
  );
  await replace.getByLabel('Search exercises').fill('Synthetic Row');
  await replace
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name: 'Synthetic Row', exact: true})
    .click();
  await expect(editor.getByLabel('Weight for Synthetic Row set 1')).toHaveValue('30');
  await expect(editor.getByLabel('Reps for Synthetic Row set 1')).toHaveValue('10');
  // Previous shows the session before this workout.
  await expect(
    editor.getByRole('button', {name: 'Previous for Synthetic Row set 1'}),
  ).toContainText('30 kg × 10');
  await options('Synthetic Row').click();
  await page.getByRole('menuitem', {name: 'Move down', exact: true}).click();
  await expect(editor.locator('.exercise-card h2')).toHaveText(['Plank', 'Synthetic Row']);
  await expect(editor.getByRole('button', {name: /^(Uncomplete|Complete) /})).toHaveCount(0);
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, 'History');
  const drawer = await openWorkout(page, 'Push day');
  await expect(drawer.locator('.recorded-sets')).toContainText(['60 s', '30 kg × 10']);
});

test('a failed history save keeps the draft for a successful retry @dev-server', async ({page}) => {
  await open(page);
  await workoutAction(page, 'Push day', 'Edit workout');
  const editor = page.locator('.history-editor');
  await editor.getByLabel('Workout name').fill('Retry session');
  await editor.getByLabel('Reps for Synthetic Press set 1').first().fill('9');
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const change = WorkoutRepository.prototype.changeHistoryWorkout;
    WorkoutRepository.prototype.changeHistoryWorkout = async function (...args: unknown[]) {
      WorkoutRepository.prototype.changeHistoryWorkout = change;
      await new Promise<void>((resolve) => {
        (window as unknown as {releaseHistorySave: () => void}).releaseHistorySave = resolve;
      });
      return change.apply(this, args);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'importSources') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor.getByRole('button', {name: 'Saving…', exact: true})).toBeDisabled();
  await expect(editor.getByLabel('Workout name')).toBeDisabled();
  await expect(editor.getByRole('button', {name: 'Back to workout'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const navigation = await cdp.send('Page.getNavigationHistory');
  await cdp.send('Page.navigateToHistoryEntry', {
    entryId: navigation.entries[navigation.currentIndex - 1].id,
  });
  await expect
    .poll(async () => (await cdp.send('Page.getNavigationHistory')).currentIndex)
    .toBe(navigation.currentIndex);
  await expect(page.getByRole('dialog', {name: 'Discard changes?'})).toHaveCount(0);
  await expect(editor).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as {releaseHistorySave: () => void}).releaseHistorySave(),
  );
  const error = editor.getByRole('alert');
  await expect(error).toContainText('Workout not saved.');
  await expect(error).toBeFocused();
  await expect(error).toBeInViewport({ratio: 1});
  await expect(editor.getByLabel('Workout name')).toHaveValue('Retry session');
  await expect(editor.getByLabel('Reps for Synthetic Press set 1').first()).toHaveValue('9');
  // The error stays in the editor, never also as a toast.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  // A retry that is blocked by the draft says why instead of repeating the failure.
  const weight = editor.getByLabel('Weight for Synthetic Press set 1').first();
  await weight.fill('');
  await editor.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(error).toContainText('Fill in the new or changed set');
  await expect(error).toBeFocused();
  await weight.fill('50');
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, 'History');
  const drawer = await openWorkout(page, 'Retry session');
  await expect(drawer.locator('.recorded-sets')).toContainText('50 kg × 9');
});

test('a newer stored revision is preserved while an edited history draft stays open @dev-server', async ({
  page,
}) => {
  await open(page);
  await workoutAction(page, 'Push day', 'Edit workout');
  const editor = page.locator('.history-editor');
  await editor.getByLabel('Workout name').fill('Local correction');
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      const state = await repository.readState();
      const current = state.dataset!.workouts.find((w: {id: string}) => w.id === 'later');
      await repository.db.meta.put({key: 'imported-sync-active', value: true});
      for (const workout of state.dataset!.workouts)
        await repository.db.importSources.put({
          key: 'imported:' + workout.id,
          value: workout.id === 'later' ? {...current, name: 'Peer correction'} : workout,
        });
      await repository.db.syncState.put({key: 'revision:later', value: 2});
    } finally {
      repository.close();
    }
  });
  const peer = await stored(page);
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor.getByRole('alert')).toContainText('changed on another device');
  await expect(editor.getByRole('alert')).toBeFocused();
  await expect(editor.getByLabel('Workout name')).toHaveValue('Local correction');
  expect(await stored(page)).toEqual(peer);
  await editor.getByRole('button', {name: 'Back to workout'}).click();
  await page.getByRole('button', {name: 'Discard changes'}).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, 'History');
  await expect(workoutCard(page, 'Peer correction')).toBeVisible();
});

test('a history workout deleted from its drawer asks first, and keeping it returns to the drawer', async ({
  page,
}) => {
  await open(page);
  await workoutAction(page, 'Pull day', 'Delete workout');
  const confirm = page.getByRole('dialog', {name: 'Delete this workout?'});
  await expect(confirm).toHaveAccessibleDescription(
    'Pull day on 1 Jan 2026 and its 1 set will be removed from history.',
  );
  await confirm.getByRole('button', {name: 'Keep workout'}).click();
  await expect(confirm).toBeHidden();
  const drawer = page.locator('.workout-drawer');
  await expect(drawer).toBeVisible();
  const options = drawer.getByRole('button', {name: /^Workout options for Pull day/});
  await expect(options).toBeFocused();

  // Deleting removes what the drawer showed, so both close onto the list.
  await options.click();
  await page.getByRole('menuitem', {name: 'Delete workout'}).click();
  await confirm.getByRole('button', {name: 'Delete workout'}).click();
  await expect(confirm).toBeHidden();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // The list already shows the confirmed delete, so it needs no toast.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

  await page.reload();
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'Push day'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toHaveCount(0);
});
