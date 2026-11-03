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

test('a history workout can be edited and the edit survives a reload', async ({page}) => {
  const value = structuredClone(seeded);
  value.dataset.workouts[0].exercises.push({
    name: 'Synthetic Press',
    type: 'weighted',
    sets: [set('p2', 55, 7)],
  });
  await open(page, value);
  await workoutAction(page, 'Push day', 'Edit workout');
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await expect(editor.getByRole('button', {name: 'Save changes'})).toBeDisabled();
  await editor.getByLabel('Workout name').fill('Heavy push');
  await editor.getByLabel('Duration (min)').fill('55');
  await expect(editor.getByLabel('Start', {exact: true})).toHaveAttribute('type', 'datetime-local');
  await editor.getByLabel('Start', {exact: true}).fill('2026-02-01T13:45');
  await editor.getByLabel('Reps for Synthetic Press set 1').first().fill('6');
  // Clearing a value blocks saving with a reason instead of storing a broken set.
  await editor.getByLabel('Weight for Synthetic Press set 1').first().fill('');
  await expect(editor.getByRole('alert')).toContainText('Fill in the new or changed set');
  await expect(editor.getByRole('button', {name: 'Save changes'})).toBeDisabled();
  await editor.getByLabel('Weight for Synthetic Press set 1').first().fill('52.5');
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor).toBeHidden();
  await expect(workoutCard(page, 'Heavy push')).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
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
  const drawer = await openWorkout(page, 'Heavy push');
  await expect(drawer.locator('.recorded-sets')).toContainText(['52.5 kg × 6', '55 kg × 7']);
  await expect(drawer).toContainText('55 min');
});

test('cancelling an edited workout asks before discarding', async ({page}) => {
  await open(page);
  const before = await stored(page);
  await workoutAction(page, 'Pull day', 'Edit workout');
  const editor = page.getByRole('dialog', {name: 'Edit workout'});
  await editor.getByLabel('Workout name').fill('Changed');
  await page.keyboard.press('Escape');
  await expect(editor.getByText('Discard your changes to this workout?')).toBeVisible();
  await editor.getByRole('button', {name: 'Keep editing'}).click();
  await expect(editor.getByLabel('Workout name')).toHaveValue('Changed');
  await expect(editor.getByLabel('Workout name')).toBeFocused();
  await editor.getByRole('button', {name: 'Cancel'}).click();
  await editor.getByRole('button', {name: 'Discard changes'}).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toBeVisible();
  expect(await stored(page)).toEqual(before);
});

for (const dismissal of ['close button', 'Escape']) {
  test(`${dismissal} brings a long workout's discard prompt into view and focuses it`, async ({
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
    await expect(editor.getByText('8 exercises · 32 sets', {exact: true})).toBeVisible();
    await editor.getByLabel('Workout name').fill('Unsaved name');
    const last = editor.getByLabel('Reps for Synthetic exercise 8 set 4');
    await last.fill('9');
    if (dismissal === 'Escape' && test.info().project.name === 'mobile') {
      const reachable = async () => {
        await expect(save).toBeInViewport({ratio: 1});
        const field = (await last.boundingBox())!;
        const footer = (await editor.locator('footer').boundingBox())!;
        expect(field.y + field.height).toBeLessThanOrEqual(footer.y);
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
    await expect(editor.getByRole('button', {name: 'Close workout editor'})).toBeInViewport({
      ratio: 1,
    });
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await editor.getByRole('button', {name: 'Close workout editor'}).click();
    const prompt = editor.getByRole('group', {name: 'Discard changes?'});
    await expect(prompt).toBeInViewport({ratio: 1});
    await expect(prompt).toBeFocused();
    // The keyboard lands on the safe option first, and cancelling retains the draft.
    await page.keyboard.press('Tab');
    await expect(prompt.getByRole('button', {name: 'Keep editing'})).toBeFocused();
    // Scroll away without answering, then dismiss again. The existing prompt must be
    // revealed and focused again, not only on its first mount.
    await editor.getByLabel('Workout name').focus();
    await editor.getByRole('button', {name: 'Add exercise', exact: true}).click();
    const picker = page.getByRole('dialog', {name: 'Add exercise', exact: true});
    await picker.getByLabel('Search exercises').fill('Plank');
    await picker.getByRole('button', {name: 'Close exercise picker'}).click();
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await editor.getByRole('button', {name: 'Close workout editor'}).click();
    await expect(prompt).toBeInViewport({ratio: 1});
    await expect(prompt).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(prompt.getByRole('button', {name: 'Keep editing'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prompt).toBeHidden();
    await expect(editor.getByLabel('Workout name')).toHaveValue('Unsaved name');
    await expect(editor.getByLabel('Workout name')).toBeFocused();
    await editor.getByRole('button', {name: 'Close workout editor'}).click();
    await prompt.getByRole('button', {name: 'Discard changes'}).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('heading', {name: 'Push day'})).toBeVisible();
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
  await page.keyboard.press('Escape');
  await expect(options('Synthetic Press')).toBeFocused();
  await expect(editor.getByRole('group', {name: 'Discard changes?'})).toHaveCount(0);
  await editor.getByRole('button', {name: 'Add exercise', exact: true}).click();
  const add = page.getByRole('dialog', {name: 'Add exercise', exact: true});
  await expect(add.getByText('To: Push day', {exact: true})).toBeVisible();
  await add.getByLabel('Search exercises').fill('Synthetic Press');
  const existing = add.getByRole('button', {name: 'Synthetic Press', exact: true});
  await expect(existing).toContainText('Already in workout');
  await existing.click();
  await expect(add.getByRole('alert')).toHaveText('Synthetic Press is already in this workout.');
  await add.getByLabel('Search exercises').fill('Plank');
  await add
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name: 'Plank', exact: true})
    .click();
  await editor.getByLabel('Seconds for Plank set 1').fill('60');
  await options('Synthetic Press').click();
  await page.keyboard.press('Escape');
  await expect(options('Synthetic Press')).toBeFocused();
  await expect(editor.getByRole('group', {name: 'Discard changes?'})).toHaveCount(0);
  await options('Synthetic Press').click();
  await page.getByRole('menuitem', {name: 'Replace exercise', exact: true}).click();
  const replace = page.getByRole('dialog', {name: 'Replace exercise', exact: true});
  await expect(replace.getByText('Replacing: Synthetic Press', {exact: true})).toBeVisible();
  await replace.getByLabel('Search exercises').fill('Plank');
  await expect(replace.getByRole('button', {name: 'Plank', exact: true})).toContainText(
    'Already in workout',
  );
  await replace.getByRole('button', {name: 'Plank', exact: true}).click();
  await expect(replace.getByRole('alert')).toHaveText('Plank is already in this workout.');
  await replace.getByLabel('Search exercises').fill('Synthetic Row');
  await replace
    .getByRole('region', {name: 'All exercises'})
    .getByRole('button', {name: 'Synthetic Row', exact: true})
    .click();
  await expect(editor.getByLabel('Weight for Synthetic Row set 1')).toHaveValue('30');
  await expect(editor.getByLabel('Reps for Synthetic Row set 1')).toHaveValue('10');
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

test('a failed history save keeps the draft for a successful retry', async ({page}) => {
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
  await expect(editor.getByRole('button', {name: 'Close workout editor'})).toBeDisabled();
  await expect(editor.getByRole('button', {name: 'Cancel', exact: true})).toBeDisabled();
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
  await expect(editor.getByRole('group', {name: 'Discard changes?'})).toHaveCount(0);
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
  await editor.getByRole('button', {name: 'Save changes'}).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, 'History');
  const drawer = await openWorkout(page, 'Retry session');
  await expect(drawer.locator('.recorded-sets')).toContainText('50 kg × 9');
});

test('a newer stored revision is preserved while an edited history draft stays open', async ({
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
  await editor.getByRole('button', {name: 'Close workout editor'}).click();
  await editor.getByRole('button', {name: 'Discard changes'}).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, 'History');
  await expect(workoutCard(page, 'Peer correction')).toBeVisible();
});

test('a history workout can be deleted after confirmation', async ({page}) => {
  await open(page);
  await workoutAction(page, 'Pull day', 'Delete workout');
  const confirm = page.getByRole('dialog', {name: 'Delete this workout?'});
  await expect(confirm).toHaveAccessibleDescription(
    'Pull day on 1 Jan 2026 and its 1 set will be removed from history.',
  );
  await confirm.getByRole('button', {name: 'Keep workout'}).click();
  await expect(confirm).toBeHidden();
  await expect(workoutCard(page, 'Pull day')).toBeFocused();

  await workoutAction(page, 'Pull day', 'Delete workout');
  await confirm.getByRole('button', {name: 'Delete workout'}).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

  await page.reload();
  await navigate(page, 'History');
  await expect(page.getByRole('heading', {name: 'Push day'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Pull day'})).toHaveCount(0);
});
