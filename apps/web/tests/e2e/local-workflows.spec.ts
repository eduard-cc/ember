import {type Page, expect, test} from '@playwright/test';

import {addExercise, navigate, pressAt, templateAction} from '../navigation';

test('templates can be created edited started and deleted @dev-server', async ({page}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({width: 412, height: 915});
  // Record haptics: confirming the template over the open draft plays the start cue.
  await page.addInitScript(() => {
    const record = window as unknown as {vibrations: number[][]};
    record.vibrations = [];
    navigator.vibrate = (pattern) => {
      record.vibrations.push(typeof pattern === 'number' ? [pattern] : [...pattern]);
      return true;
    };
  });
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template'}).click();
  const editor = page.getByRole('dialog', {name: 'New template', exact: true});
  await expect(editor).toBeVisible();
  await expect(page.getByRole('button', {name: 'Start empty workout'})).toHaveCount(0);
  // Saving says what is missing, by the name and by Add exercise, and focuses the name.
  const name = editor.getByLabel('Template name');
  await editor.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAccessibleDescription('Enter a template name.');
  await expect(editor.locator('.add-exercise-problem')).toHaveText('Add an exercise.');
  await expect(editor).toBeVisible();
  await name.fill('My test session');
  await expect(editor.getByText('Enter a template name.')).toHaveCount(0);
  await addExercise(page, 'Bench Press (Barbell)');
  await expect(editor.getByText('Add an exercise.')).toHaveCount(0);
  // Previous gives the latest actual sets as evidence; the targets start empty.
  await expect(
    editor.getByRole('button', {name: 'Previous for Bench Press (Barbell) set 1'}),
  ).toContainText(/\d+ kg × \d+/);
  const weight = editor.getByLabel('Weight for Bench Press (Barbell) set 1');
  const reps = editor.getByLabel('Reps for Bench Press (Barbell) set 1');
  expect((await weight.boundingBox())!.width).toBeGreaterThan(100);
  await weight.fill('62.5');
  await weight.press('Enter');
  await expect(reps).toBeFocused();
  await reps.fill('9');
  await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My test session'})).toBeVisible();
  const card = page.locator('.template-card', {hasText: 'My test session'});
  // The card shows the result, so there is no toast; a brief Amber border marks it.
  await expect(card).toHaveAttribute('data-landed', '');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  // The row shows what Start will prefill: Bench Press's latest demo sets.
  await expect(card.locator('.exercise-line')).toHaveCount(1);
  await expect(card.locator('.exercise-line')).toContainText('Bench Press (Barbell)');
  await expect(card.locator('.exercise-line')).toContainText(/\d+ kg/);
  await expect(card).toContainText('1 exercise');
  await expect(card).toContainText('Not done yet');
  await templateAction(page, 'Edit template', 'My test session');
  await page.getByLabel('Template name').fill('Edited session');
  const editPanel = page.getByRole('dialog', {name: 'Edit template', exact: true});
  for (let n = 0; n < 12; n++)
    await editPanel.getByRole('button', {name: 'Add set', exact: true}).click();
  const lastReps = editPanel.getByLabel(/Reps for .* set \d+$/).last();
  await lastReps.fill('11');
  const save = editPanel.getByRole('button', {name: 'Save template', exact: true});
  const reachable = async () => {
    const button = (await save.boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.y).toBeGreaterThanOrEqual(0);
    expect(button.y + button.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const field = (await lastReps.boundingBox())!;
    const panel = (await editPanel.boundingBox())!;
    expect(field.y + field.height).toBeLessThanOrEqual(panel.y + panel.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  };
  await reachable();
  for (const size of [
    {width: 320, height: 740},
    {width: 740, height: 320},
    {width: 412, height: 390},
  ]) {
    await page.setViewportSize(size);
    await lastReps.focus();
    await expect(async () => reachable()).toPass();
  }
  await page.setViewportSize({width: 412, height: 915});
  // Visual-only keyboard resize/pan: the layout viewport remains 915px tall.
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: {configurable: true, value: 390},
      offsetTop: {configurable: true, value: 40},
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => {
      const box = (await editPanel.boundingBox())!;
      return [Math.round(box.y), Math.round(box.height)];
    })
    .toEqual([40, 390]);
  await expect(async () => reachable()).toPass();
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, 'height');
    Reflect.deleteProperty(window.visualViewport!, 'offsetTop');
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await save.click();
  await expect(editPanel).toBeHidden();
  const persisted = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      return (await repository.readState()).templates.find(
        (t: {name: string}) => t.name === 'Edited session',
      );
    } finally {
      repository.close();
    }
  });
  expect(persisted.exercises[0].sets[0]).toMatchObject({weight: 62.5, reps: 9, completed: false});
  expect(persisted.exercises[0].sets.at(-1)).toMatchObject({reps: 11, completed: false});
  // Pressing the card's exercise drawing opens its preview.
  await pressAt(
    page,
    page.locator('.template-card', {hasText: 'Edited session'}).locator('.drawing'),
  );
  await page.getByRole('button', {name: 'Start template Edited session', exact: true}).click();
  await page.evaluate(() => ((window as unknown as {vibrations: number[][]}).vibrations = []));
  await page.getByRole('button', {name: 'Replace active draft'}).click();
  await expect(page.getByLabel('workout name', {exact: false})).toHaveValue('Edited session');
  expect(
    await page.evaluate(() => (window as unknown as {vibrations: number[][]}).vibrations),
  ).toEqual([[18, 60, 10]]);
  await navigate(page, 'Workouts');
  await templateAction(page, 'Delete template', 'Edited session');
  await expect(
    page.getByRole('dialog', {name: 'Delete this template?'}),
  ).toHaveAccessibleDescription('Edited session will be removed.');
  await page.getByRole('button', {name: 'Confirm delete template'}).click();
  await expect(page.getByRole('heading', {name: 'Edited session'})).toHaveCount(0);
});
/** The first History workout's name and how many templates already carry it. */
async function firstWorkout(page: Page) {
  await navigate(page, 'History');
  const name = (await page.locator('.history-card h3').first().textContent())!;
  await navigate(page, 'Workouts');
  const cards = page.locator('.template-card', {hasText: name});
  await expect(page.getByRole('button', {name: 'Create template'})).toBeVisible();
  const before = await cards.count();
  await navigate(page, 'History');
  return {cards, before};
}
test('Save as template confirms with a toast that closes itself, and stays quiet during a workout', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // The demo opens with a draft; discard it so no workout is running.
  await page.getByRole('button', {name: 'Cancel workout'}).click();
  await page.getByRole('button', {name: 'Discard workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toHaveCount(0);
  const {cards, before} = await firstWorkout(page);
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: 'Save as template'}).click();
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toHaveText('Template saved');
  await expect(toast).toHaveAttribute('data-type', 'success');
  // The template opens on the Workout tab; nothing lingers there once the toast has gone.
  await expect(cards).toHaveCount(before + 1);
  await expect(page.getByRole('region', {name: 'Template'})).toHaveCount(0);
  await expect(toast).toHaveCount(0, {timeout: 6000});

  // During a workout the result shows on the Workout tab without a toast.
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  await navigate(page, 'History');
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: 'Save as template'}).click();
  await expect(cards).toHaveCount(before + 2);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(toast).toHaveCount(0);
});
test('a failed template save shows a Retry toast during a workout and saves the template once', async ({
  page,
}) => {
  // Two failed saves, a 4s wait and a reload: more than the default 30s on a loaded runner.
  test.setTimeout(60_000);
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const {cards, before} = await firstWorkout(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    const state = window as unknown as {restoreTemplateAdd: () => void};
    state.restoreTemplateAdd = () => (IDBObjectStore.prototype.add = add);
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'templates')
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: 'Save as template'}).click();
  await expect(page.getByRole('alert')).toContainText('Could not save on this device');
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toContainText('Template not saved');
  await expect(toast).toHaveAttribute('data-type', 'error');
  // Rounded: the toast's entrance transform can leave a 44px button a hair under 44.
  for (const label of ['Retry', 'Dismiss'])
    expect(
      Math.round(
        (await toast.getByRole('button', {name: label, exact: true}).boundingBox())!.height,
      ),
    ).toBeGreaterThanOrEqual(44);
  // A failure stays until it is retried or dismissed.
  await page.waitForTimeout(4000);
  await expect(toast).toContainText('Template not saved');
  // On phones it sits at the top and swipes away upwards; the next failure brings it back.
  const box = (await toast.boundingBox())!;
  expect(box.y).toBeLessThan(100);
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y - 60, {steps: 6});
  await page.mouse.up();
  await expect(toast).toHaveCount(0);
  await navigate(page, 'History');
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: 'Save as template'}).click();
  await expect(toast).toContainText('Template not saved');

  await page.evaluate(() =>
    (window as unknown as {restoreTemplateAdd: () => void}).restoreTemplateAdd(),
  );
  await toast.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The demo's draft is still running, so the saved template needs no toast.
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await expect(toast).toHaveCount(0);
  const saved = before + 2;
  await expect(cards).toHaveCount(saved);
  await page.reload();
  await navigate(page, 'Workouts');
  await expect(cards).toHaveCount(saved);
});
test('template editor retains a failed save and closes after a successful retry @dev-server', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Create template', exact: true}).click();
  const editor = page.locator('.template-editor');
  await editor.getByLabel('Template name').fill('Retry template');
  await addExercise(page, 'Bench Press (Barbell)');
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const commit = WorkoutRepository.prototype.commitState;
    const state = window as unknown as {releaseTemplateCommit: () => void};
    WorkoutRepository.prototype.commitState = async function (...args: unknown[]) {
      WorkoutRepository.prototype.commitState = commit;
      await new Promise<void>((resolve) => {
        state.releaseTemplateCommit = resolve;
      });
      return commit.apply(this, args);
    };
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'templates') {
        IDBObjectStore.prototype.add = add;
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return add.apply(this, args);
    };
  });
  await editor.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(editor.getByRole('button', {name: 'Saving…', exact: true})).toBeDisabled();
  await expect(editor.getByLabel('Template name')).toBeDisabled();
  await expect(editor.getByRole('button', {name: 'Close template editor'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as {releaseTemplateCommit: () => void}).releaseTemplateCommit(),
  );
  await expect(editor.getByRole('alert')).toContainText('Template not saved.');
  await expect(editor.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(editor.getByLabel('Template name')).toHaveValue('Retry template');
  await editor.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await navigate(page, 'Workouts');
  await expect(page.getByRole('heading', {name: 'Retry template', exact: true})).toBeVisible();
});

test('IndexedDB quota-error injection retains memory and never reports saved', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  // Chromium's incognito IDB backend ignores CDP quota overrides. Inject the
  // platform error at the real IDB write boundary; hydration/happy path are real.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts')
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByLabel('WORKOUT NAME', {exact: true}).fill('Unsaved edit '.repeat(10000));
  await expect(page.getByRole('alert')).toContainText('Could not save on this device');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'error');
  // A problem strip under the logger's header, in the layout: it covers no sets and Finish stays
  // in reach.
  const strip = page.locator('.workout-sheet .status-strip');
  await expect(strip).toHaveText(/^Can’t save on this phone/);
  const header = (await page.locator('.workout-top').boundingBox())!;
  const shown = (await strip.boundingBox())!;
  const sets = (await page.locator('.workout-scroll').boundingBox())!;
  expect(shown.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(sets.y).toBeGreaterThanOrEqual(shown.y + shown.height - 1);
  expect(shown.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeInViewport();
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue(
    'Unsaved edit '.repeat(10000),
  );
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue('Upper body A');
});
test('invalid numbers cannot be completed and untick a completed set', async ({page}) => {
  await page.goto('/?demo=1');
  const card = page.locator('.exercise-card').first();
  const reps = card.getByLabel(/Reps for .* set 1$/);
  // Named "Complete …" or "Uncomplete …" depending on state.
  const complete = card.getByRole('button', {name: /complete .* set 1$/i});
  await reps.fill('3.5');
  await expect(complete).toBeDisabled();
  await reps.fill('8');
  await complete.click();
  await expect(complete).toHaveAttribute('aria-pressed', 'true');
  await reps.fill('1001');
  await expect(complete).toHaveAttribute('aria-pressed', 'false');
  await expect(complete).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Finish workout'})).toBeDisabled();
});
