import {expect, test} from '@playwright/test';

test('undo distinguishes duplicate exercise names even after deleting the only set', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gym-log');
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
  await exercises
    .nth(1)
    .getByRole('button', {name: /Actions for/})
    .click();
  await exercises
    .nth(1)
    .getByRole('button', {name: /Delete/})
    .click();
  await exercises
    .first()
    .getByLabel(/Weight/)
    .fill('80');
  await exercises.nth(1).getByRole('button', {name: 'Add set', exact: true}).click();
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(exercises.first().getByLabel(/Weight/)).toHaveValue('80');
  await expect(
    exercises
      .nth(1)
      .getByLabel(/Weight/)
      .first(),
  ).toHaveValue('42.5');
  await expect(exercises.nth(1).getByRole('button', {name: /Uncomplete/})).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(exercises.nth(1).getByLabel(/Weight/)).toHaveCount(2);
});

test('phone landscape keeps first editable set in the usable viewport', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.setViewportSize({width: 844, height: 390});
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  // Load can finish while the logger is still hidden and disabled behind hydration/sync lock.
  await expect(weight).toBeVisible();
  await expect(weight).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const field = (await weight.boundingBox())!;
  const navigation = page.getByRole('navigation', {name: 'Main navigation'});
  await expect(navigation).toBeVisible();
  const nav = (await navigation.boundingBox())!;
  expect(field.y).toBeGreaterThanOrEqual(0);
  expect(field.y + field.height).toBeLessThanOrEqual(nav.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
});

test('real touch swipe from completion reveals actions without confirming and vertical touch scrolls', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'mobile');
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5188/?demo=1');
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
  await row.getByRole('button', {name: 'Cancel', exact: true}).click();
  await touch(200, 650, 0, -200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  await context.close();
});

test('mobile ledger reaches first set quickly with wide fields and explicit empty completion', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.goto('/?demo=1');
  const weight = page.getByLabel(/Weight for .* set 1/).first();
  await expect(weight).toBeEnabled();
  const box = (await weight.boundingBox())!;
  expect(box.y).toBeLessThan(300);
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(await weight.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  const row = page.locator('.set-row:not(.set-head)').first();
  await expect(row.getByRole('button', {name: /Complete/})).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(
    await row
      .getByRole('button', {name: /Complete/})
      .locator('svg')
      .count(),
  ).toBe(0);
  for (const control of await row.locator('button:visible, input').all()) {
    const rect = (await control.boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({width: 320, height: 740});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('focused mobile field stays above resized viewport and navigation returns after editing', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile');
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
  await drag(row.locator('input').first(), -100, 0);
  await expect(number).toHaveAttribute('aria-expanded', 'false');
  await drag(number, -100, 0);
  await expect(number).toHaveAttribute('aria-expanded', 'true');
  expect(await row.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
});

test('set number exposes keyboard-accessible deletion and undo survives earlier exercise removal', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const exercises = page.locator('.exercise-card');
  const secondName = await exercises.nth(1).getByRole('heading').textContent();
  const action = exercises.nth(1).getByRole('button', {name: /Actions for .* set 1/});
  await action.focus();
  await page.keyboard.press('Enter');
  await exercises
    .nth(1)
    .getByRole('button', {name: /Delete .* set 1/})
    .click();
  await exercises
    .first()
    .getByRole('button', {name: /^Remove [^]*$/})
    .first()
    .click();
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(exercises.first().getByRole('heading')).toHaveText(secondName!);
  await expect(exercises.first().getByRole('button', {name: /Actions for .* set/})).toHaveCount(3);
});

test('left swipe reveals Delete without deleting; undo restores values, order and completion', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  const weights = page.getByLabel(/Weight for .* set/);
  await weights.first().fill('42.5');
  await page
    .getByRole('button', {name: /Complete .* set 1/})
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
  await row.getByRole('button', {name: /Delete .* set 1/}).click();
  await weights.first().fill('51');
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(weights.nth(0)).toHaveValue('42.5');
  await expect(weights.nth(1)).toHaveValue('51');
  await expect(page.getByRole('button', {name: /Uncomplete .* set 1/}).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
