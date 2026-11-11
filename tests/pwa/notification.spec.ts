import {type BrowserContext, type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

const tag = 'ember-active-workout';
const shown = (page: Page) =>
  page.evaluate(
    async (tag) =>
      (await (await navigator.serviceWorker.ready).getNotifications({tag})).map((item) => ({
        title: item.title,
        body: item.body,
        badge: item.badge,
        silent: item.silent,
      })),
    tag,
  );
/**
 * An allowing OS and its notification centre. CI's headless Chromium reports notifications as
 * denied and keeps no list, so the permission reads granted and the registration's two
 * notification methods keep a per-tab list that survives reloads and counts shows. The worker
 * and the app are real.
 */
const notificationCentre = (context: BrowserContext) =>
  context.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {configurable: true, get: () => 'granted'});
    type Shown = {title: string; options: NotificationOptions};
    const read = () => JSON.parse(sessionStorage.getItem('notifications') ?? '[]') as Shown[];
    const write = (list: Shown[]) => sessionStorage.setItem('notifications', JSON.stringify(list));
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options = {}) {
      sessionStorage.setItem('shows', String(Number(sessionStorage.getItem('shows') ?? 0) + 1));
      write([...read().filter((item) => item.options.tag !== options.tag), {title, options}]);
    };
    ServiceWorkerRegistration.prototype.getNotifications = async function (filter = {}) {
      return read()
        .filter((item) => !filter.tag || item.options.tag === filter.tag)
        .map(
          (item) =>
            ({
              title: item.title,
              body: item.options.body,
              badge: item.options.badge,
              silent: item.options.silent,
              close: () => write(read().filter((other) => other.options.tag !== item.options.tag)),
            }) as unknown as Notification,
        );
    };
  });
const shows = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem('shows') ?? 0));

test('an allowed device shows one workout notification that resumes the logger and clears on discard', async ({
  page,
  context,
}) => {
  await notificationCentre(context);
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await expect
    .poll(() => shown(page))
    .toEqual([
      {
        title: 'Workout active',
        body: expect.stringMatching(/^Started at \d\d:\d\d · Tap to resume$/),
        badge: expect.stringMatching(/\/icons\/badge-96\.png$/),
        silent: true,
      },
    ]);
  // Editing the workout and relaunching it do not post it again.
  await page.getByLabel('WORKOUT NAME').fill('Synthetic push');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Synthetic push');
  await expect.poll(() => shown(page)).toHaveLength(1);
  expect(await shows(page)).toBe(1);

  // A dismissed notification stays dismissed for this workout.
  await page.evaluate(async (tag) => {
    for (const item of await (await navigator.serviceWorker.ready).getNotifications({tag}))
      item.close();
  }, tag);
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Synthetic push');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');
  expect(await shown(page)).toHaveLength(0);
  expect(await shows(page)).toBe(1);

  // The worker's tap message brings the minimized logger back without a reload, closing a
  // Replace prompt that was open over the page.
  await page.getByRole('button', {name: 'Minimize workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeHidden();
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  const replace = page.getByRole('dialog', {name: 'Replace your active workout?'});
  await expect(replace).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as {marker: boolean}).marker = true;
  });
  const [worker] = context.serviceWorkers();
  // Asked from the worker, only the tab that owns the draft says so; a second, read-only tab
  // stays quiet.
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('.app-shell')).toHaveAttribute('data-save', /^(saved|error)$/);
  const owners = () =>
    worker.evaluate(async () => {
      const scope = self as unknown as {
        clients: {
          matchAll(
            options: object,
          ): Promise<{url: string; postMessage(message: object, ports: MessagePort[]): void}[]>;
        };
      };
      const windows = await scope.clients.matchAll({type: 'window'});
      return Promise.all(
        windows.map(
          (client) =>
            new Promise<boolean>((resolve) => {
              const channel = new MessageChannel();
              channel.port1.onmessage = (answer) => resolve(answer.data === true);
              setTimeout(() => resolve(false), 1000);
              client.postMessage({type: 'EMBER_WORKOUT_OWNER'}, [channel.port2]);
            }),
        ),
      );
    });
  await expect.poll(async () => (await owners()).sort()).toEqual([false, true]);
  await second.close();
  await worker.evaluate(async () => {
    const scope = self as unknown as {
      clients: {matchAll(options: object): Promise<{postMessage(message: object): void}[]>};
    };
    for (const client of await scope.clients.matchAll({type: 'window'}))
      client.postMessage({type: 'EMBER_RESUME_WORKOUT'});
  });
  await expect(replace).toBeHidden();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Synthetic push');
  expect(await page.evaluate(() => (window as unknown as {marker?: boolean}).marker)).toBe(true);

  // Turning it off and on in Settings shows it again; discarding the workout clears it.
  await page.getByRole('button', {name: 'Settings'}).last().click();
  const row = page.getByRole('switch', {name: 'Active workout'});
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => shown(page)).toHaveLength(1);
  await page.getByRole('button', {name: 'Close settings'}).click();
  await page.getByRole('button', {name: 'Cancel workout'}).click();
  await page.getByRole('button', {name: 'Discard workout'}).click();
  await expect.poll(() => shown(page)).toHaveLength(0);
});
