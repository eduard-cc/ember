import {type Page, expect, test} from '@playwright/test';

import {templateAction} from '../navigation';

const demo = [
  'Bench Press (Barbell)',
  'Seated Row (Cable)',
  'Incline Bench Press (Dumbbell)',
  'Lateral Raise (Dumbbell)',
  'Pull Up (Assisted)',
];

async function start(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  const sheet = page.getByRole('region', {name: 'Active workout'});
  await expect(sheet.locator('.exercise-card h2')).toHaveText(demo);
  return sheet;
}

const heading = (page: Page, name: string) =>
  page.getByRole('button', {name: `Show details for ${name}`, exact: true});

/** Press and hold a header with the mouse until the compact list appears. */
async function lift(page: Page, name: string) {
  await heading(page, name).scrollIntoViewIfNeeded();
  // Let the scroll settle: a scroll during the hold means the press was a scroll, not a hold.
  await page.waitForTimeout(150);
  const box = (await heading(page, name).boundingBox())!;
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toBeVisible();
  return {x, y};
}

const rows = (page: Page) => page.locator('.reorder-row');

/** Glide the held row to the centre of the row currently in slot `slot`. */
async function dragTo(page: Page, from: {x: number; y: number}, slot: number) {
  const target = (await rows(page).nth(slot).boundingBox())!;
  const held = (await page.locator('.reorder-row[data-held]').boundingBox())!;
  const grab = from.y - (held.y + held.height / 2);
  const y = target.y + target.height / 2 + grab;
  await page.mouse.move(from.x, y, {steps: 12});
}

const savedOrder = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('ember');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('drafts').objectStore('drafts').getAll();
          read.onsuccess = () =>
            resolve(
              (read.result[0]?.workout ?? read.result[0])?.exercises?.map(
                (ex: {name: string}) => ex.name,
              ) ?? [],
            );
          read.onerror = () => reject(read.error);
        };
      }),
  );

test('holding an exercise header collapses the workout and dragging moves the whole exercise', async ({
  page,
}) => {
  const sheet = await start(page);
  // A completed set must travel with its exercise.
  const bench = sheet.locator('.exercise-card').first();
  await bench.getByRole('button', {name: 'Complete Bench Press (Barbell) set 1'}).click();
  const benchWeight = await bench.getByLabel('Weight for Bench Press (Barbell) set 1').inputValue();

  const point = await lift(page, 'Bench Press (Barbell)');
  // Every exercise is a compact row with its set count, the held one marked.
  await expect(rows(page).locator('.reorder-name')).toHaveText(demo);
  await expect(page.locator('.reorder-row[data-held]')).toContainText('Bench Press (Barbell)');
  // The cards stay mounted underneath (no rebuild on drop) but are hidden.
  for (const card of await sheet.locator('.exercise-card').all()) await expect(card).toBeHidden();
  for (const row of await rows(page).all())
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);

  await dragTo(page, point, 2);
  // The others slide aside before the drop.
  await expect
    .poll(() =>
      rows(page)
        .nth(1)
        .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42),
    )
    .toBeLessThan(-40);
  // Observe before release: the tint can finish while the runner checks the order.
  const highlight = await bench.evaluateHandle((card) => {
    const observed = {attribute: null as string | null, animationName: '', animationDuration: ''};
    const observer = new MutationObserver(() => {
      if (!card.hasAttribute('data-dropped')) return;
      const style = getComputedStyle(card);
      observed.attribute = card.getAttribute('data-dropped');
      observed.animationName = style.animationName;
      observed.animationDuration = style.animationDuration;
      observer.disconnect();
    });
    observer.observe(card, {attributes: true, attributeFilter: ['data-dropped']});
    return observed;
  });
  await page.mouse.up();

  const order = [demo[1], demo[2], demo[0], demo[3], demo[4]];
  await expect(sheet.locator('.exercise-card h2')).toHaveText(order);
  const moved = sheet.locator('.exercise-card').nth(2);
  // A brief tint marks where it landed, then clears when the animation finishes.
  await expect
    .poll(() => highlight.jsonValue())
    .toEqual({
      attribute: '',
      animationName: 'dropped-card',
      animationDuration: '0.9s',
    });
  await highlight.dispose();
  await expect(moved).not.toHaveAttribute('data-dropped', '');
  await expect(
    moved.getByRole('button', {name: 'Uncomplete Bench Press (Barbell) set 1'}),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(moved.getByLabel('Weight for Bench Press (Barbell) set 1')).toHaveValue(benchWeight);
  // The release after a hold is not a tap: details stay closed.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The moved card's heading is in view where it was dropped.
  await expect(moved.locator('.exercise-heading')).toBeInViewport();

  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(
    page.getByRole('region', {name: 'Active workout'}).locator('.exercise-card h2'),
  ).toHaveText(order);
});

test('dragging upward to the top, and Escape puts a held exercise back', async ({page}) => {
  const sheet = await start(page);
  let point = await lift(page, 'Pull Up (Assisted)');
  await dragTo(page, point, 0);
  await page.mouse.up();
  await expect(sheet.locator('.exercise-card h2')).toHaveText([demo[4], ...demo.slice(0, 4)]);

  point = await lift(page, 'Seated Row (Cable)');
  await dragTo(page, point, 4);
  await page.keyboard.press('Escape');
  await expect(sheet.locator('.exercise-card h2')).toHaveText([demo[4], ...demo.slice(0, 4)]);
  await page.mouse.up();
  await expect(sheet.locator('.exercise-card h2')).toHaveText([demo[4], ...demo.slice(0, 4)]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a short press on a header opens details, and the ⋯ menu offers Move up and Move down', async ({
  page,
}) => {
  const sheet = await start(page);
  await heading(page, 'Seated Row (Cable)').click();
  await expect(page.getByRole('dialog', {name: 'Seated Row (Cable)'})).toBeVisible();
  await page.getByRole('button', {name: 'Back to workout'}).click();
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toHaveCount(0);

  const menu = (name: string) => page.getByRole('menu', {name: `Exercise options for ${name}`});
  const options = (name: string) =>
    page.getByRole('button', {name: `Exercise options for ${name}`, exact: true});
  await options(demo[0]).click();
  await expect(menu(demo[0]).getByRole('menuitem')).toHaveText([
    'Replace exercise',
    'Move down',
    'Remove exercise',
  ]);
  await page.keyboard.press('Escape');
  await options(demo[4]).click();
  await expect(menu(demo[4]).getByRole('menuitem')).toHaveText([
    'Replace exercise',
    'Move up',
    'Remove exercise',
  ]);
  await page.keyboard.press('Escape');

  // Keyboard: Move down keeps focus on the same exercise's ⋯.
  await options(demo[1]).focus();
  await page.keyboard.press('Enter');
  await menu(demo[1]).getByRole('menuitem', {name: 'Move down'}).click();
  await expect(sheet.locator('.exercise-card h2')).toHaveText([
    demo[0],
    demo[2],
    demo[1],
    demo[3],
    demo[4],
  ]);
  await expect(options(demo[1])).toBeFocused();
  await options(demo[1]).click();
  await menu(demo[1]).getByRole('menuitem', {name: 'Move up'}).click();
  await expect(sheet.locator('.exercise-card h2')).toHaveText(demo);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  expect(await savedOrder(page)).toEqual(demo);
});

test('a single exercise has nothing to reorder', async ({page}) => {
  const sheet = await start(page);
  for (const name of demo.slice(1)) {
    await page.getByRole('button', {name: `Exercise options for ${name}`, exact: true}).click();
    await page.getByRole('menuitem', {name: 'Remove exercise'}).click();
  }
  await expect(sheet.locator('.exercise-card')).toHaveCount(1);
  const box = (await heading(page, demo[0]).boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toHaveCount(0);
  await page.mouse.up();
  // Without a lift it was just a (slow) tap on the name.
  await page.getByRole('button', {name: 'Back to workout'}).click();
  await page.getByRole('button', {name: `Exercise options for ${demo[0]}`, exact: true}).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Replace exercise', 'Remove exercise']);
});

test('real touch: hold and drag reorders without scrolling away, and a quick swipe scrolls', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'mobile');
  const context = await browser.newContext({
    viewport: {width: 412, height: 915},
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?demo=1`);
  const sheet = page.getByRole('region', {name: 'Active workout'});
  await expect(sheet.locator('.exercise-card h2')).toHaveText(demo);
  await expect(heading(page, demo[1])).toBeEnabled();
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}],
    });

  // A quick vertical swipe that starts on a header scrolls the logger and lifts nothing.
  const scroller = page.locator('.workout-scroll');
  let box = (await heading(page, demo[1]).boundingBox())!;
  await touch('touchStart', box.x + 60, box.y + 20);
  for (let i = 1; i <= 8; i++) await touch('touchMove', box.x + 60, box.y + 20 - i * 25);
  await touch('touchEnd');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toHaveCount(0);
  // Fling momentum must be over before the hold, or its scrolling ends the hold.
  await expect
    .poll(async () => {
      const a = await scroller.evaluate((el) => el.scrollTop);
      await page.waitForTimeout(250);
      return a === (await scroller.evaluate((el) => el.scrollTop));
    })
    .toBe(true);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(250);

  // Hold Seated Row, then drag it below Lateral Raise.
  box = (await heading(page, demo[1]).boundingBox())!;
  const x = box.x + 60;
  let y = box.y + box.height / 2;
  await touch('touchStart', x, y);
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toBeVisible();
  const before = await scroller.evaluate((el) => el.scrollTop);
  const held = (await page.locator('.reorder-row[data-held]').boundingBox())!;
  // The held row appears under the finger.
  expect(Math.abs(held.y + held.height / 2 - y)).toBeLessThan(held.height);
  const target = (await rows(page).nth(3).boundingBox())!;
  const end = target.y + target.height / 2;
  for (let i = 1; i <= 10; i++) {
    y = held.y + held.height / 2 + ((end - (held.y + held.height / 2)) * i) / 10;
    await touch('touchMove', x, y);
  }
  // The browser did not take the drag over as a scroll.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  await touch('touchEnd');
  await expect(sheet.locator('.exercise-card h2')).toHaveText([
    demo[0],
    demo[2],
    demo[3],
    demo[1],
    demo[4],
  ]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Screen readers hear where it went.
  await expect(page.locator('[data-reorder-announcement]')).toHaveText(
    `Moved ${demo[1]} to position 4 of 5`,
  );

  // A touch drag produces no click: the guard against a stray click must not eat the next
  // keyboard activation.
  const options = page.getByRole('button', {name: `Exercise options for ${demo[0]}`, exact: true});
  await options.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', {name: `Exercise options for ${demo[0]}`})).toBeVisible();
  await page.keyboard.press('Escape');

  // Held low on the screen in a list too short to scroll, the row still sits under the finger,
  // and every slot stays reachable without the finger leaving the screen.
  await scroller.evaluate((el) => (el.scrollTop = 0));
  const incline = heading(page, demo[2]);
  await incline.evaluate((el) => {
    const s = el.closest('.workout-scroll')!;
    s.scrollTop += el.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom + 30;
  });
  await page.waitForTimeout(250);
  box = (await incline.boundingBox())!;
  y = box.y + box.height / 2;
  await touch('touchStart', x, y);
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toBeVisible();
  const low = (await page.locator('.reorder-row[data-held]').boundingBox())!;
  expect(Math.abs(low.y + low.height / 2 - y)).toBeLessThan(low.height);
  const bottom = page.viewportSize()!.height - 2;
  for (let i = 1; i <= 10; i++) await touch('touchMove', x, y + ((bottom - y) * i) / 10);
  // Auto-scroll near the edge brings the last slot within reach.
  await page.waitForTimeout(1500);
  await touch('touchEnd');
  await expect(sheet.locator('.exercise-card h2')).toHaveText([
    demo[0],
    demo[3],
    demo[1],
    demo[4],
    demo[2],
  ]);
  await context.close();
});

test('a release just as the hold completes ends the lift and keeps the order', async ({page}) => {
  // The finger lifts between the hold timer and the list attaching its own listeners.
  await page.addInitScript(() => {
    let pointerId = 0;
    document.addEventListener('pointerdown', (e) => (pointerId = e.pointerId), true);
    const setTimer = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (ms === 400 && typeof fn === 'function')
        return setTimer(() => {
          fn(...rest);
          document.body.dispatchEvent(
            new PointerEvent('pointerup', {pointerId, bubbles: true, isPrimary: true}),
          );
        }, ms);
      return setTimer(fn, ms, ...rest);
    }) as typeof window.setTimeout;
  });
  const sheet = await start(page);
  const box = (await heading(page, demo[1]).boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toHaveCount(0);
  await expect(sheet.locator('.exercise-card h2')).toHaveText(demo);
  await page.mouse.up();
});

test('the template editor reorders exercises the same way', async ({page}) => {
  await start(page);
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await page
    .getByRole('navigation', {name: 'Main navigation'})
    .getByRole('button', {name: 'Workout', exact: true})
    .click();
  await templateAction(page, 'Edit template');
  const editor = page.locator('.template-editor');
  const names = await editor.locator('.exercise-card h2').allTextContents();
  expect(names.length).toBeGreaterThan(1);
  const title = editor.locator('.exercise-title').first();
  const box = (await title.boundingBox())!;
  const point = {x: box.x + 60, y: box.y + box.height / 2};
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByRole('list', {name: 'Reorder exercises'})).toBeVisible();
  await dragTo(page, point, 1);
  await page.mouse.up();
  await expect(editor.locator('.exercise-card h2')).toHaveText([
    names[1],
    names[0],
    ...names.slice(2),
  ]);
});

for (const [width, height, padding] of [
  [390, 844, '12px 16px'],
  [320, 740, '12px'],
  [1440, 1000, '14px 24px'],
] as const) {
  test(`the lifted reorder list pads ${padding} at ${width}x${height}`, async ({page}, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.setViewportSize({width, height});
    await start(page);
    await lift(page, demo[1]);
    const list = page.getByRole('list', {name: 'Reorder exercises'});
    const css = await list.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
    });
    const [top, right, bottom, left] = css;
    expect(top).toBe(bottom);
    expect(right).toBe(left);
    expect(top === right ? top : `${top} ${right}`).toBe(padding);
    await page.mouse.up();
  });
}
