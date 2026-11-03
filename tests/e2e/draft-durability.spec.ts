import {expect, test} from '@playwright/test';

import {demoTemplates} from '../../src/domain/demo';
import {closeCelebration} from '../navigation';

const legacy = {
  version: 1,
  dataset: null,
  active: {...demoTemplates[0], id: 'source-draft', date: '2026-01-10T12:00:00'},
  finished: [],
  templates: demoTemplates,
};
test('Saving stays visible until the real IndexedDB transaction can commit', async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ember');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('drafts', 'readwrite');
    let hold = true;
    Object.assign(window, {
      releaseStorageTest: () => {
        hold = false;
      },
    });
    const cycle = () => {
      const request = transaction.objectStore('drafts').get('active');
      request.onsuccess = () => {
        if (hold) cycle();
      };
    };
    cycle();
    transaction.oncomplete = () => db.close();
  });
  await page.getByLabel('WORKOUT NAME', {exact: true}).fill('Commit boundary');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saving');
  await expect(page.getByText('Saving…', {exact: true})).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as {releaseStorageTest: () => void}).releaseStorageTest(),
  );
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue('Commit boundary');
});
test('failed outbox insert rolls back finish in the browser and allows retry', async ({
  page,
}, info) => {
  await page.goto('/?demo=1');
  await page
    .getByRole('button', {name: /Complete .* set 1/})
    .first()
    .click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ember');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const operationId = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('outbox', 'readwrite');
      transaction.objectStore('outbox').add({
        operationId,
        entityId: 'earlier',
        kind: 'deleteTemplate',
        expectedRevision: 1,
        payload: null,
      });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    const uuid = crypto.randomUUID.bind(crypto);
    Object.assign(window, {
      restoreUUIDTest: () => {
        crypto.randomUUID = uuid;
      },
    });
    crypto.randomUUID = () => operationId;
  });
  await page.getByRole('button', {name: 'Finish workout'}).click();
  await page.getByRole('button', {name: 'Save finished workout'}).click();
  await expect(page.getByRole('alert')).toContainText('Workout was not finished');
  const confirmation = page.getByRole('dialog', {name: 'Finish this workout?', exact: true});
  await expect(confirmation.getByRole('region', {name: 'Workout not saved'})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Active workout'})).toHaveCount(0);
  expect(
    await page
      .locator(
        '.workout-sheet [role=alert], .workout-sheet [role=status], .workout-sheet [aria-live]',
      )
      .count(),
  ).toBe(0);
  await expect(page.getByRole('dialog', {name: 'Workout complete'})).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'error');
  const readCounts = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('ember');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const counts = await Promise.all(
        ['drafts', 'workouts', 'outbox'].map(
          (name) =>
            new Promise<number>((resolve) => {
              const request = db.transaction(name).objectStore(name).count();
              request.onsuccess = () => resolve(request.result);
            }),
        ),
      );
      db.close();
      return counts;
    });
  expect(await readCounts()).toEqual([1, 0, 1]);
  await page.evaluate(() => (window as unknown as {restoreUUIDTest: () => void}).restoreUUIDTest());
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('ember');
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction('workouts', 'readwrite');
    let hold = true;
    Object.assign(window, {
      releaseFinishStorage: () => {
        hold = false;
      },
    });
    const cycle = () => {
      transaction.objectStore('workouts').get('pending').onsuccess = () => {
        if (hold) cycle();
      };
    };
    cycle();
    transaction.oncomplete = () => db.close();
  });
  await page.getByRole('button', {name: 'Save finished workout'}).click();
  await expect(confirmation.getByRole('button', {name: 'Saving…', exact: true})).toBeDisabled();
  await expect(confirmation.getByRole('button', {name: 'Keep logging'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeVisible();
  const navigation = await page.context().newCDPSession(page);
  if (info.project.name === 'mobile') {
    await navigation.send('Emulation.setTouchEmulationEnabled', {enabled: true});
    const beforeSwipe = (await confirmation.boundingBox())!;
    const x = beforeSwipe.x + beforeSwipe.width / 2;
    const y = beforeSwipe.y + 20;
    await navigation.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{x, y}],
    });
    for (let step = 1; step <= 8; step++) {
      await navigation.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{x, y: y + step * 20}],
      });
    }
    await navigation.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await expect
      .poll(async () => (await confirmation.boundingBox())!.y)
      .toBeCloseTo(beforeSwipe.y, 0);
    await expect(confirmation.getByRole('button', {name: 'Saving…', exact: true})).toBeInViewport();
  }
  const {entries, currentIndex} = await navigation.send('Page.getNavigationHistory');
  await navigation.send('Page.navigateToHistoryEntry', {entryId: entries[currentIndex - 1].id});
  await expect(confirmation).toBeVisible();
  await expect
    .poll(async () => (await navigation.send('Page.getNavigationHistory')).currentIndex)
    .toBe(currentIndex);
  await expect(page.getByRole('dialog', {name: 'Workout complete'})).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as {releaseFinishStorage: () => void}).releaseFinishStorage(),
  );
  await closeCelebration(page);
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible();
  expect(await readCounts()).toEqual([0, 1, 2]);
});
test('second same-origin tab is read-only until writer closes', async ({page, context}) => {
  await page.goto('/?demo=1');
  await expect(page.getByLabel('WORKOUT NAME', {exact: true})).toBeEditable();
  const follower = await context.newPage();
  await follower.goto('/');
  await expect(follower.getByRole('alert')).toContainText('Another tab is editing');
  await expect(follower.getByLabel('WORKOUT NAME', {exact: true})).toBeDisabled();
  await page.getByLabel('WORKOUT NAME', {exact: true}).fill('Writer owns this');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.close();
  await follower.reload();
  await expect(follower.getByLabel('WORKOUT NAME', {exact: true})).toBeEditable();
  await expect(follower.getByLabel('WORKOUT NAME', {exact: true})).toHaveValue('Writer owns this');
});
test('missing Web Locks blocks editing with a clear error, never a race-prone fallback', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', {value: undefined}));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Web Locks');
  await expect(page.getByRole('button', {name: 'Start empty workout'})).toBeDisabled();
});
test('empty installation has no synthetic draft or history', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Quick start', exact: true})).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBeNull();
});
test('saved edit survives a fresh page and original legacy bytes remain unchanged', async ({
  page,
  context,
}) => {
  const raw = JSON.stringify(legacy, null, 2);
  await page.addInitScript((raw) => localStorage.setItem('ember:v1', raw), raw);
  await page.goto('/');
  await page
    .getByLabel(/Weight for .* set 1/)
    .first()
    .fill('42.5');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  expect(await page.evaluate(() => localStorage.getItem('ember:v1'))).toBe(raw);
  await page.close();
  const fresh = await context.newPage();
  await fresh.goto('/');
  await expect(fresh.getByLabel(/Weight for .* set 1/).first()).toHaveValue('42.5');
  expect(
    await fresh.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('ember');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise((resolve) => {
        const request = db.transaction('drafts').objectStore('drafts').get('active');
        request.onsuccess = () => {
          resolve(request.result.workout.exercises[0].sets[0].id);
          db.close();
        };
      });
    }),
  ).toBe(legacy.active.exercises[0].sets[0].id);
});
