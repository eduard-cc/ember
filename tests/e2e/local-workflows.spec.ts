import {expect, test} from '@playwright/test';

import {addExercise, navigate, templateAction} from '../navigation';

test('templates can be created edited started and deleted', async ({page}, info) => {
  if (info.project.name === 'mobile') {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 412, height: 915});
  }
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
  const editor = page.getByRole('dialog', {name: 'Create a template', exact: true});
  await expect(editor).toBeVisible();
  await expect(page.getByRole('button', {name: 'Start empty workout'})).toHaveCount(0);
  await expect(editor.getByRole('button', {name: 'Save template', exact: true})).toBeDisabled();
  await expect(editor).toContainText('Enter a name and add an exercise.');
  await page.getByLabel('Template name').fill('My test session');
  await addExercise(page, 'Bench Press (Barbell)');
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
    const footer = (await editPanel.locator('footer').boundingBox())!;
    expect(field.y + field.height).toBeLessThanOrEqual(footer.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  };
  await reachable();
  if (info.project.name === 'mobile') {
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
  }
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
  await page.getByRole('button', {name: 'Open template Edited session', exact: true}).click();
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
test('a failed template commit never announces that it was saved', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await navigate(page, 'History');
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'templates')
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.locator('.history-card button').first().click();
  await page.getByRole('button', {name: 'Save as template'}).click();
  await expect(page.getByRole('alert')).toContainText('Could not save on this device');
  await expect(page.getByText('Workout saved as an editable template.', {exact: true})).toHaveCount(
    0,
  );
});
test('template editor retains a failed save and closes after a successful retry', async ({
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
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(editor.getByLabel('Template name')).toHaveValue('Retry template');
  await expect(editor.getByRole('button', {name: 'Save template', exact: true})).toBeEnabled();
  await editor.getByRole('button', {name: 'Save template', exact: true}).click();
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
