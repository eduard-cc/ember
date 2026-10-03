import {type Page, expect} from '@playwright/test';

import {openSettings} from '../navigation';

// Legacy password-mode coverage authenticates via the API, never app password UI.
export async function login(page: Page) {
  const response = await page.request.post('/api/v1/session', {
    headers: {Origin: 'http://127.0.0.1:5188'},
    data: {password: process.env.GYM_LOG_TEST_PASSWORD!},
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('status', {name: 'Server synchronization'})).toHaveText(
    /^(Synced|Sync conflict or rejection · local changes kept for review\/export)$/,
  );
}

export async function syncNow(page: Page, keepSettingsOpen = false) {
  await openSettings(page);
  await page.getByRole('button', {name: 'Sync now', exact: true}).click();
  if (!keepSettingsOpen) await page.getByRole('button', {name: 'Close settings'}).click();
}

export async function revokeAndLock(page: Page) {
  await page.evaluate(async () => {
    const session = await (await fetch('/api/v1/session')).json();
    const response = await fetch('/api/v1/session', {
      method: 'DELETE',
      headers: {'X-CSRF-Token': session.csrfToken},
    });
    if (!response.ok) throw new Error('Test session revocation failed');
    const path = '/src/storage/repository.ts';
    const {WorkoutRepository} = await import(path);
    const repository = new WorkoutRepository();
    try {
      await repository.db.meta.put({key: 'local-trust', value: false});
    } finally {
      repository.close();
    }
  });
}
