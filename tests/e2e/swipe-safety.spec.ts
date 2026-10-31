import {type Locator, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

async function pointer(target: Locator, type: string, x: number, id = 1) {
  await target.dispatchEvent(type, {
    pointerId: id,
    pointerType: 'touch',
    button: 0,
    buttons: type === 'pointermove' || type === 'pointerdown' ? 1 : 0,
    clientX: x,
    clientY: 20,
  });
}

const offset = (row: Locator) =>
  row
    .locator('.set-swipe-content')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);

for (const via of ['long swipe', 'Delete tap'])
  test(`a deleted row collapses once and never reappears before removal (${via})`, async ({
    page,
  }, info) => {
    await page.goto('/?demo=1');
    const rows = page.locator('.set-row:not(.set-head)');
    const row = rows.nth(1);
    await expect(row.getByRole('button', {name: /Actions for/})).toBeEnabled();
    const count = await rows.count();
    // Record the row's painted height and slide every frame until it leaves the DOM.
    await row.evaluate((el) => {
      const frames: {h: number; x: number}[] = [];
      (window as unknown as {__frames: typeof frames}).__frames = frames;
      const content = el.querySelector('.set-swipe-content')!;
      const tick = () => {
        if (!el.isConnected) return;
        frames.push({
          h: el.getBoundingClientRect().height,
          x: new DOMMatrix(getComputedStyle(content).transform).m41,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const width = (await row.boundingBox())!.width;
    if (via === 'long swipe') {
      await pointer(row, 'pointerdown', width * 0.9);
      await pointer(row, 'pointermove', width * 0.1);
      await pointer(row, 'pointerup', width * 0.1);
    } else {
      await row.getByRole('button', {name: /Actions for/}).click();
      // Phones choose Delete set from the set's action drawer; desktop reveals the row's Delete.
      if (info.project.name === 'mobile')
        await page
          .getByRole('menu', {name: /^Actions for /})
          .getByRole('menuitem', {name: 'Delete set'})
          .click();
      else await row.getByRole('button', {name: /^Delete /}).click();
    }
    await expect(rows).toHaveCount(count - 1);
    const frames = await page.evaluate(
      () => (window as unknown as {__frames: {h: number; x: number}[]}).__frames,
    );
    const collapse = frames.findIndex((f) => f.h < 56);
    expect(collapse).toBeGreaterThan(-1);
    // Once the gap starts closing it only shrinks, and the row never slides back toward view.
    for (let i = collapse; i < frames.length; i++) {
      expect(frames[i].h).toBeLessThanOrEqual(frames[i - 1]?.h ?? 56);
      expect(frames[i].x).toBeLessThanOrEqual(Math.min(frames[i - 1]?.x ?? 0, -40));
    }
  });

test('gestures inside Previous evidence never drive the set behind the portal', async ({page}) => {
  await page.goto('/?demo=1');
  const rows = page.locator('.set-row:not(.set-head)');
  const row = rows.first();
  await row.getByRole('button', {name: /Previous for/}).click();
  const dialog = page.getByRole('dialog');
  await pointer(dialog, 'pointerdown', 330);
  await pointer(dialog, 'pointermove', 40);
  expect(await offset(row)).toBe(0);
  await pointer(dialog, 'pointerup', 40);
  await page.getByRole('button', {name: 'Close previous sets'}).click();
  await expect(row.getByRole('button', {name: /Actions for/})).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

for (const phase of ['before swipe', 'during exit'])
  test(`a disabled workout keeps its row visible (${phase})`, async ({page}) => {
    await page.goto('/?demo=1');
    const rows = page.locator('.set-row:not(.set-head)');
    const row = rows.first();
    await expect(row.getByRole('button', {name: /Actions for/})).toBeEnabled();
    const count = await rows.count();
    if (phase === 'before swipe')
      await row.evaluate((el) => ((el.closest('fieldset') as HTMLFieldSetElement).disabled = true));
    await pointer(row, 'pointerdown', 330);
    await pointer(row, 'pointermove', 40);
    if (phase === 'before swipe') expect(await offset(row)).toBe(0);
    await pointer(row, 'pointerup', 40);
    if (phase === 'during exit') {
      await row.evaluate((el) => {
        // Freeze exactly between the user's release and the deferred delete.
        const animations = el.getAnimations();
        animations.forEach((animation) => animation.pause());
        (el.closest('fieldset') as HTMLFieldSetElement).disabled = true;
        animations.forEach((animation) => animation.finish());
      });
    }
    await expect(rows).toHaveCount(count);
    await expect.poll(() => row.evaluate((el) => el.getBoundingClientRect().height)).toBe(56);
    await expect.poll(() => offset(row)).toBe(0);
    expect(await row.evaluate((el) => (el as HTMLElement).inert)).toBe(false);
    await row.evaluate((el) => ((el.closest('fieldset') as HTMLFieldSetElement).disabled = false));
    await expect(row.getByRole('button', {name: /Actions for/})).toBeEnabled();
  });

test('canceling the template editor cancels its pending row deletion', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page
    .getByRole('button', {name: /Edit template/})
    .first()
    .click();
  const editor = page.locator('.template-editor');
  const row = editor.locator('.set-row:not(.set-head)').first();
  const width = (await row.boundingBox())!.width;
  await pointer(row, 'pointerdown', width * 0.9);
  await pointer(row, 'pointermove', width * 0.1);
  await pointer(row, 'pointerup', width * 0.1);
  const animation = await row.evaluateHandle((el) => {
    const animation = el.getAnimations()[0];
    animation.pause();
    return animation;
  });
  await page.getByRole('button', {name: 'Cancel template editing'}).click();
  // Completing a detached row's exit must not reopen the editor with stale data.
  await animation.evaluate((animation) => animation.finish());
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.template-grid')).toBeVisible();
  await page
    .getByRole('button', {name: /Edit template/})
    .first()
    .click();
  await expect(editor.getByRole('button', {name: 'Save template', exact: true})).toBeEnabled();
});

for (const end of ['pointerup', 'pointercancel'])
  test(`a second finger's ${end} does not interrupt the first drag`, async ({page}) => {
    await page.goto('/?demo=1');
    const row = page.locator('.set-row:not(.set-head)').first();
    await expect(row.getByRole('button', {name: /Actions for/})).toBeEnabled();
    await pointer(row, 'pointerdown', 180);
    await pointer(row, 'pointermove', 160);
    await pointer(row, 'pointerdown', 180, 2);
    await pointer(row, end, 180, 2);
    await pointer(row, 'pointermove', 80);
    expect(await offset(row)).toBe(-100);
    await pointer(row, 'pointerup', 80);
    await expect(row.getByRole('button', {name: /Actions for/})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

for (const end of ['lostpointercapture', 'mouse release', 'window blur'])
  test(`a drag recovers after ${end}`, async ({page}) => {
    await page.goto('/?demo=1');
    const row = page.locator('.set-row:not(.set-head)').first();
    await expect(row.getByRole('button', {name: /Actions for/})).toBeEnabled();
    await pointer(row, 'pointerdown', 180);
    await pointer(row, 'pointermove', 160);
    if (end === 'window blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else if (end === 'mouse release')
      await row.dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 0,
        clientX: 160,
        clientY: 20,
      });
    else await pointer(row, 'lostpointercapture', 160);
    await expect.poll(() => offset(row)).toBe(0);
    await pointer(row, 'pointerdown', 180);
    await pointer(row, 'pointermove', 80);
    expect(await offset(row)).toBe(-100);
    await pointer(row, 'pointerup', 80);
  });

test('keyboard actions expose Delete immediately and Escape returns focus to the set number', async ({
  page,
}, info) => {
  await page.goto('/?demo=1');
  const row = page.locator('.set-row:not(.set-head)').first();
  // Located by label: while the phone drawer is open the ledger is hidden from the a11y tree.
  const action = row.locator('.set-index');
  await action.focus();
  await page.keyboard.press('Enter');
  if (info.project.name === 'mobile') {
    const sheet = page.getByRole('menu', {name: /^Actions for .* set 1$/});
    await expect(sheet.getByRole('menuitem', {name: 'Delete set'})).toBeFocused();
    await expect(action).toHaveAttribute('aria-expanded', 'true');
  } else {
    const remove = row.getByRole('button', {name: /^Delete /});
    await expect(remove).toBeFocused();
    expect(
      await row
        .locator('.set-swipe-content')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe('0s');
  }
  await page.keyboard.press('Escape');
  await expect(action).toBeFocused();
  await expect(action).toHaveAttribute('aria-expanded', 'false');
  expect(await action.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('-2px');
});

test('template-editor swipe rows use the containing surface background', async ({page}) => {
  await page.goto('/?demo=1');
  await navigate(page, 'Workouts');
  await page
    .getByRole('button', {name: /Edit template/})
    .first()
    .click();
  const editor = page.locator('.template-editor');
  const background = await editor.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(
    await editor
      .locator('.set-swipe-content')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(background);
});

async function pendingDelete(row: Locator) {
  const width = (await row.boundingBox())!.width;
  await pointer(row, 'pointerdown', width * 0.9);
  await pointer(row, 'pointermove', width * 0.1);
  await pointer(row, 'pointerup', width * 0.1);
  return row.evaluateHandle((el) => {
    const animation = el.getAnimations()[0];
    animation.pause();
    return animation;
  });
}

for (const completion of ['staggered', 'together'])
  test(`Save waits for every pending template-set deletion (${completion})`, async ({page}) => {
    await page.goto('/?demo=1');
    await navigate(page, 'Workouts');
    await page
      .getByRole('button', {name: /Edit template/})
      .first()
      .click();
    const editor = page.locator('.template-editor');
    const name = await editor.getByLabel('Template name').inputValue();
    const rows = editor.locator('.set-row:not(.set-head)');
    const count = await rows.count();
    const first = await pendingDelete(rows.nth(0));
    const second = await pendingDelete(rows.nth(1));
    const save = editor.getByRole('button', {name: 'Save template', exact: true});
    await expect(save).toBeDisabled();
    if (completion === 'staggered') {
      await first.evaluate((animation) => animation.finish());
      await expect(rows).toHaveCount(count - 1);
      await expect(save).toBeDisabled();
      await second.evaluate((animation) => animation.finish());
    } else {
      await page.evaluate(
        ([a, b]) => {
          a.finish();
          b.finish();
        },
        [first, second],
      );
    }
    await expect(rows).toHaveCount(count - 2);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(editor).toHaveCount(0);
    const card = page
      .locator('.template-card')
      .filter({has: page.getByRole('heading', {name, exact: true})});
    const targetCount = await card
      .locator('.template-open li')
      .evaluateAll((rows) =>
        rows.reduce((sum, row) => sum + Number(row.textContent?.split(' × ')[0]), 0),
      );
    expect(targetCount).toBe(count - 2);
  });

test('Finish waits for an active workout row to complete its deletion', async ({page}) => {
  await page.goto('/?demo=1');
  const rows = page.locator('.set-row:not(.set-head)');
  await rows
    .first()
    .getByRole('button', {name: /Complete/})
    .click();
  const finish = page.getByRole('button', {name: 'Finish workout', exact: true});
  await expect(finish).toBeEnabled();
  const count = await rows.count();
  const animation = await pendingDelete(rows.nth(1));
  await expect(finish).toBeDisabled();
  await animation.evaluate((animation) => animation.finish());
  await expect(rows).toHaveCount(count - 1);
  await expect(finish).toBeEnabled();
});
