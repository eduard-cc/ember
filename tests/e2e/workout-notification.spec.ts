import {type Page, devices, expect, test} from '@playwright/test';

import {navigate, openSettings} from '../navigation';

test.use({...devices['Pixel 6']});

/** The OS permission prompt: answers each request in turn and counts them. */
async function stubPermission(page: Page, answers: NotificationPermission[]) {
  // The answers survive reloads, like the browser's own permission state.
  await page.addInitScript((answers) => {
    const count = () => Number(localStorage.getItem('requests'));
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        get permission() {
          return count() ? answers[count() - 1] : 'default';
        },
        requestPermission: async () => {
          localStorage.setItem('requests', String(Math.min(count() + 1, answers.length)));
          return answers[count() - 1];
        },
      },
    });
  }, answers);
}
const requests = (page: Page) => page.evaluate(() => Number(localStorage.getItem('requests')));

test('the first Start asks for notification permission once and Settings can ask again or turn it off', async ({
  page,
}) => {
  await stubPermission(page, ['default', 'denied']);
  await page.goto('/');
  await openSettings(page);
  const row = page.getByRole('switch', {name: 'Active workout'});
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect(row).toHaveAccessibleDescription('Not allowed yet.');
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await requests(page)).toBe(0);

  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  await expect.poll(() => requests(page)).toBe(1);
  // Dismissing the prompt is remembered: the next workout starts without asking.
  await page.getByRole('button', {name: 'Cancel workout'}).click();
  await page.getByRole('button', {name: 'Discard workout'}).click();
  await navigate(page, 'Workouts');
  await page.getByRole('button', {name: 'Start empty workout'}).click();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  expect(await requests(page)).toBe(1);

  await openSettings(page);
  await page.getByRole('button', {name: 'Allow notifications'}).click();
  await expect(row).toHaveAccessibleDescription('Blocked for Ember in your phone’s settings.');
  await expect(page.getByRole('button', {name: 'Allow notifications'})).toHaveCount(0);
  expect(await requests(page)).toBe(2);
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await expect(row).toHaveAccessibleDescription('Shows while you log a workout. Tap it to resume.');
});

test.describe('an iPhone Safari tab', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  test('is told to add Ember to the Home Screen, without a switch', async ({page}) => {
    await page.addInitScript(() => Reflect.deleteProperty(window, 'Notification'));
    await page.goto('/');
    await openSettings(page);
    const group = page.getByRole('region', {name: 'Notification'});
    await expect(group).toContainText('Add Ember to your Home Screen to get it.');
    await expect(group.getByRole('switch')).toHaveCount(0);
    await navigate(page, 'Workouts');
    await page.getByRole('button', {name: 'Start empty workout'}).click();
    await expect(page.getByRole('region', {name: 'Active workout'})).toBeVisible();
  });
});
