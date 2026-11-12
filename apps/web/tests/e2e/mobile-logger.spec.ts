import {expect, test} from '@playwright/test';

import {deleteSet} from '../navigation';

test('deleting the only set of a duplicate-named exercise removes exactly that set, without an undo banner', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ember');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      const request = store.get('active');
      request.onsuccess = () => {
        const draft = request.result;
        draft.workout.exercises = draft.workout.exercises
          .slice(0, 2)
          .map((exercise: {name: string; sets: unknown[]}) => ({
            ...exercise,
            name: 'Duplicate exercise',
            sets: exercise.sets.slice(0, 1),
          }));
        draft.workout.exercises[0].sets[0].weight = 77;
        draft.workout.exercises[1].sets[0].weight = 42.5;
        draft.workout.exercises[1].sets[0].completed = true;
        store.put(draft);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  const exercises = page.locator('.exercise-card');
  await deleteSet(page, exercises.nth(1).locator('.set-row:not(.set-head)'));
  await exercises
    .first()
    .getByLabel(/Weight/)
    .fill('80');
  await expect(exercises).toHaveCount(2);
  await expect(exercises.nth(1).getByLabel(/Weight/)).toHaveCount(0);
  // Deleting an exercise shows no Removed/Undo banner.
  await expect(page.getByText(/^Removed /)).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
  await expect(exercises.first().getByLabel(/Weight/)).toHaveValue('80');
  await exercises.nth(1).getByRole('button', {name: 'Add set', exact: true}).click();
  // The new set belongs to the second exercise; the first duplicate keeps its own set.
  await expect(exercises.nth(1).getByLabel(/Weight/)).toHaveCount(1);
  await expect(exercises.nth(1).getByLabel(/Weight/)).toHaveValue('');
  await expect(exercises.first().getByLabel(/Weight/)).toHaveCount(1);
  await expect(exercises.first().getByLabel(/Weight/)).toHaveValue('80');
});

test('phone landscape keeps first editable set in the usable viewport', async ({page}) => {
  await page.setViewportSize({width: 844, height: 390});
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  // Load can finish while the logger is still hidden and disabled behind hydration/sync lock.
  await expect(weight).toBeVisible();
  await expect(weight).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const field = (await weight.boundingBox())!;
  // The expanded workout sheet covers the main navigation.
  await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeHidden();
  expect(field.y).toBeGreaterThanOrEqual(100);
  expect(field.y + field.height).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
});

test('real touch swipe from completion reveals actions without confirming and vertical touch scrolls', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?demo=1`);
  const row = page.locator('.set-row:not(.set-head)').first();
  const done = row.getByRole('button', {name: /Complete/});
  // The logger stays hidden and disabled until storage hydrates and the sync lock clears.
  await expect(done).toBeEnabled();
  const box = (await done.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const touch = async (x: number, y: number, dx: number, dy: number) => {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{x: x + (dx * step) / 8, y: y + (dy * step) / 8}],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  };
  await touch(box.x + 22, box.y + 22, -100, 0);
  await expect(row.getByRole('button', {name: /Delete/})).toBeVisible();
  await expect(done).toHaveAttribute('aria-pressed', 'false');
  // Tapping the slid row closes it again, without toggling completion.
  await row.locator('.set-swipe-content').click({position: {x: 200, y: 20}});
  await expect(row.getByRole('button', {name: /Delete/})).toBeHidden();
  await expect(done).toHaveAttribute('aria-pressed', 'false');
  await touch(200, 650, 0, -200);
  await expect
    .poll(() => page.locator('.workout-scroll').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(50);
  await context.close();
});

test('mobile ledger reaches first set quickly with wide fields and explicit empty completion', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  await expect(weight).toBeEnabled();
  const box = (await weight.boundingBox())!;
  expect(box.y).toBeLessThan(300);
  // Approved five-column ledger trades the previous two wide fields for source evidence.
  expect(box.width).toBeGreaterThanOrEqual(72);
  expect(await weight.evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');
  const row = page.locator('.set-row:not(.set-head)').first();
  await expect(row.getByRole('button', {name: /Complete/})).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // An empty square: the check is not drawn until the set is confirmed.
  const marker = row.getByRole('button', {name: /Complete/}).locator('.check-box');
  await expect(marker).not.toHaveAttribute('data-done');
  await expect(marker.locator('.check-path')).toHaveCSS('stroke-dashoffset', '24px');
  for (const control of await row.locator('button:visible, input').all()) {
    const rect = (await control.boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  // The completion box lines up with the fields beside it, top and bottom.
  const check = (await row.getByRole('button', {name: /Complete/}).boundingBox())!;
  const reps = (await row.getByLabel(/Reps for/).boundingBox())!;
  expect(check.y).toBeCloseTo(reps.y, 0);
  expect(check.height).toBeCloseTo(reps.height, 0);
  await page.setViewportSize({width: 320, height: 740});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('focused mobile field stays above resized viewport and navigation returns after editing', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).nth(2);
  await expect(weight).toBeEnabled();
  await weight.focus();
  await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeHidden();
  await page.setViewportSize({width: 390, height: 380});
  await expect
    .poll(async () => {
      const box = (await weight.boundingBox())!;
      return box.y >= 0 && box.y + box.height <= 380;
    })
    .toBe(true);
  await weight.fill('45');
  await expect(page.getByRole('button', {name: /Complete .* set 1/}).nth(2)).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await weight.evaluate((el) => (el as HTMLInputElement).blur());
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeVisible();
});

test('number swipe works while vertical, canceled and input drags do not reveal Delete', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const row = page.locator('.set-row:not(.set-head)').first();
  const number = row.getByRole('button', {name: /Actions for/});
  const drag = async (target: typeof row, dx: number, dy: number, cancel = false) => {
    await target.dispatchEvent('pointerdown', {
      pointerId: 9,
      clientX: 160,
      clientY: 20,
      pointerType: 'touch',
      button: 0,
    });
    await target.dispatchEvent('pointermove', {
      pointerId: 9,
      clientX: 160 + dx,
      clientY: 20 + dy,
      pointerType: 'touch',
    });
    await target.dispatchEvent(cancel ? 'pointercancel' : 'pointerup', {
      pointerId: 9,
      clientX: 160 + dx,
      clientY: 20 + dy,
      pointerType: 'touch',
    });
  };
  await drag(row, -10, 90);
  await expect(number).toHaveAttribute('aria-expanded', 'false');
  await drag(row, -100, 0, true);
  await expect(number).toHaveAttribute('aria-expanded', 'false');
  // A focused field keeps horizontal drags for caret movement.
  await row.locator('input').first().focus();
  await drag(row.locator('input').first(), -100, 0);
  await expect(number).toHaveAttribute('aria-expanded', 'false');
  await row.locator('input').first().blur();
  await drag(number, -100, 0);
  await expect(number).toHaveAttribute('aria-expanded', 'true');
  expect(await row.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
});

test('set number exposes keyboard-accessible deletion of exactly that set', async ({page}) => {
  await page.goto('/?demo=1');
  const exercises = page.locator('.exercise-card');
  const weights = exercises.nth(1).getByLabel(/Weight for .* set/);
  await expect(weights).toHaveCount(3);
  await weights.nth(0).fill('11');
  await weights.nth(1).fill('22');
  await weights.nth(2).fill('33');
  const action = exercises.nth(1).getByRole('button', {name: /Actions for .* set 1/});
  await action.focus();
  // Enter opens the set's actions with Delete focused (the drawer's Delete set on phones, the
  // row's Delete from 1000px); Enter again deletes.
  await page.keyboard.press('Enter');
  await expect(page.locator(':focus')).toHaveText(/^Delete/);
  await page.keyboard.press('Enter');
  await expect(weights).toHaveCount(2);
  await expect(weights.nth(0)).toHaveValue('22');
  await expect(weights.nth(1)).toHaveValue('33');
  await expect(exercises.first().getByLabel(/Weight for .* set/)).toHaveCount(3);
});

test('left swipe reveals Delete without deleting; Delete removes that set and keeps the order', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const weights = page.getByLabel(/Weight for .* set/);
  await weights.first().fill('42.5');
  await weights.nth(1).fill('47.5');
  await page
    .getByRole('button', {name: /Complete .* set 2/})
    .first()
    .click();
  const row = page.locator('.set-row:not(.set-head)').first();
  await row.dispatchEvent('pointerdown', {
    pointerId: 7,
    clientX: 180,
    clientY: 20,
    pointerType: 'touch',
    button: 0,
  });
  await row.dispatchEvent('pointermove', {
    pointerId: 7,
    clientX: 65,
    clientY: 23,
    pointerType: 'touch',
  });
  await row.dispatchEvent('pointerup', {
    pointerId: 7,
    clientX: 65,
    clientY: 23,
    pointerType: 'touch',
  });
  await expect(row.getByRole('button', {name: /Delete .* set 1/})).toBeVisible();
  await expect(weights.first()).toHaveValue('42.5');
  const before = await weights.count();
  await row.getByRole('button', {name: /Delete .* set 1/}).click();
  // The row slides out and collapses before it leaves the workout.
  await expect(weights).toHaveCount(before - 1);
  // Former set 2 moves up with its value and completion intact.
  await expect(weights.nth(0)).toHaveValue('47.5');
  await expect(page.getByRole('button', {name: /Uncomplete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('swipe follows the finger from the weight field, settles open, and a long swipe deletes', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?demo=1`);
  const rows = page.locator('.set-row:not(.set-head)');
  const row = rows.first();
  const weight = row.getByLabel(/Weight for .* set 1/);
  await expect(weight).toBeEnabled();
  const count = await rows.count();
  const cdp = await context.newCDPSession(page);
  const shift = () =>
    row
      .locator('.set-swipe-content')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  const box = (await weight.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  for (let step = 1; step <= 4; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: x - step * 10, y, id: 1}],
    });
  await expect(weight).not.toBeFocused();
  // Mid-gesture, the row tracks the finger instead of waiting for a threshold.
  expect(await shift()).toBeLessThan(-25);
  expect(await shift()).toBeGreaterThan(-45);
  // A slow release before halfway snaps back; past halfway it settles open.
  for (let step = 5; step <= 7; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: x - step * 10, y, id: 1}],
    });
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(row.getByRole('button', {name: /^Delete /})).toBeVisible();
  await expect.poll(shift).toBeLessThan(-80);
  await expect(weight).not.toBeFocused();
  // Continuing from the open position past most of the row deletes outright.
  const start = (await row.boundingBox())!;
  const sx = start.x + start.width - 40;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{x: sx, y, id: 2}],
  });
  for (let step = 1; step <= 10; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: sx - step * 28, y, id: 2}],
    });
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect(rows).toHaveCount(count - 1);
  await context.close();
});
