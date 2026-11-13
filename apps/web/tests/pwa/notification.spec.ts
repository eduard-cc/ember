import {type BrowserContext, type Page, expect, test} from '@playwright/test';

import {navigate} from '../navigation';

const tag = 'ember-active-workout';
const shown = (page: Page) =>
  page.evaluate(
    async (tag) =>
      (await (await navigator.serviceWorker.ready).getNotifications({tag})).map((item) => ({
        title: item.title,
        body: item.body,
        // Chromium shows the badge; TypeScript's DOM types omit it as not cross-browser.
        badge: (item as Notification & {badge?: string}).badge,
        silent: item.silent,
      })),
    tag,
  );
/**
 * An allowing OS and its notification centre. CI's headless Chromium reports notifications as
 * denied and keeps no list, so the permission reads granted and the registration's two
 * notification methods keep one list for the device that survives reloads and counts shows.
 * The worker and the app are real.
 */
const notificationCentre = (context: BrowserContext) =>
  context.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {configurable: true, get: () => 'granted'});
    type Shown = {title: string; options: NotificationOptions};
    const read = () => JSON.parse(localStorage.getItem('notifications') ?? '[]') as Shown[];
    const write = (list: Shown[]) => localStorage.setItem('notifications', JSON.stringify(list));
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options = {}) {
      localStorage.setItem('shows', String(Number(localStorage.getItem('shows') ?? 0) + 1));
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
              data: item.options.data as unknown,
              close: () => write(read().filter((other) => other.options.tag !== item.options.tag)),
            }) as unknown as Notification,
        );
    };
  });
const shows = (page: Page) => page.evaluate(() => Number(localStorage.getItem('shows') ?? 0));
const dismiss = (page: Page) =>
  page.evaluate(async (tag) => {
    for (const item of await (await navigator.serviceWorker.ready).getNotifications({tag}))
      item.close();
  }, tag);
/** Switching to another app and back: headless pages never go hidden on their own. */
const switchAway = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => state});
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
const saved = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-save', 'saved');

test('an allowed device shows one workout notification, restores it when Ember is reopened, resumes the logger and clears on discard', async ({
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
  // Editing the workout and relaunching while it is shown leave it alone.
  await page.getByLabel('WORKOUT NAME').fill('Synthetic push');
  await saved(page);
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Synthetic push');
  await saved(page);
  await expect.poll(() => shown(page)).toHaveLength(1);
  expect(await shows(page)).toBe(1);

  // Dismissed, it stays away through edits and autosaves and while Ember is in the background,
  // then coming back restores it once.
  await dismiss(page);
  await page.getByLabel('WORKOUT NAME').fill('Synthetic push day');
  await saved(page);
  await switchAway(page, 'hidden');
  await page.getByLabel('WORKOUT NAME').fill('Synthetic push');
  await saved(page);
  expect(await shown(page)).toHaveLength(0);
  await switchAway(page, 'visible');
  await expect.poll(() => shown(page)).toHaveLength(1);
  expect(await shows(page)).toBe(2);
  await switchAway(page, 'hidden');
  await switchAway(page, 'visible');
  await saved(page);
  expect(await shows(page)).toBe(2);

  // Reopening Ember after a dismissal restores it.
  await dismiss(page);
  await page.reload();
  await expect(page.getByLabel('WORKOUT NAME')).toHaveValue('Synthetic push');
  await expect.poll(() => shown(page)).toHaveLength(1);
  expect(await shows(page)).toBe(3);

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
  // The read-only tab neither clears the owner's notification nor brings back a dismissed one.
  expect(await shown(second)).toHaveLength(1);
  await dismiss(page);
  await switchAway(second, 'hidden');
  await switchAway(second, 'visible');
  await expect(second.locator('.app-shell')).toHaveAttribute('data-save', /^(saved|error)$/);
  expect(await shown(second)).toHaveLength(0);
  expect(await shows(page)).toBe(3);
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

  // Switched off in Settings, coming back does not show it; switching it on does, and
  // discarding the workout clears it.
  await page.getByRole('button', {name: 'Settings'}).last().click();
  const row = page.getByRole('switch', {name: 'Active workout'});
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await switchAway(page, 'hidden');
  await switchAway(page, 'visible');
  await saved(page);
  expect(await shown(page)).toHaveLength(0);
  expect(await shows(page)).toBe(3);
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => shown(page)).toHaveLength(1);
  await page.getByRole('button', {name: 'Close settings'}).click();
  await page.getByRole('button', {name: 'Cancel workout'}).click();
  await page.getByRole('button', {name: 'Discard workout'}).click();
  await expect.poll(() => shown(page)).toHaveLength(0);
});
