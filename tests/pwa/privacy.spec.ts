import {expect, test} from '@playwright/test';
import {mkdir, rm, rmdir, writeFile} from 'node:fs/promises';

test('Cache Storage contains only the finite shell allowlist, never API, CSV or arbitrary requests', async ({
  page,
  context,
}) => {
  const api = new URL('../../dist/api/pwa-probe.json', import.meta.url);
  const csv = new URL('../../dist/private/export.csv', import.meta.url);
  await mkdir(new URL('.', api), {recursive: true});
  await mkdir(new URL('.', csv), {recursive: true});
  await writeFile(api, '{"synthetic":"api-not-for-cache"}');
  await writeFile(csv, 'Synthetic;CSV;not-for-cache');
  try {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    const responses = await page.evaluate(async () =>
      Promise.all(
        [
          '/api/pwa-probe.json',
          '/private/export.csv',
          '/index.html?synthetic=private',
          '/anything-else',
        ].map(async (path) => (await fetch(path)).text()),
      ),
    );
    expect(responses[0]).toContain('api-not-for-cache');
    expect(responses[1]).toContain('CSV;not-for-cache');
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      return Promise.all(
        names.map(async (name) => ({
          name,
          paths: (await (await caches.open(name)).keys()).map(
            (request) => new URL(request.url).pathname + new URL(request.url).search,
          ),
        })),
      );
    });
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toMatch(/^ember-shell-[a-f0-9]{24}$/);
    expect(cached[0].paths).toEqual(
      expect.arrayContaining([
        '/index.html',
        '/manifest.webmanifest',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ]),
    );
    expect(
      cached[0].paths.every(
        (path) =>
          /^\/assets\/[^?]+$/.test(path) ||
          [
            '/index.html',
            '/manifest.webmanifest',
            '/icons/icon-192.png',
            '/icons/icon-512.png',
          ].includes(path),
      ),
    ).toBe(true);
    const registration = await page.evaluate(async () => {
      const r = (await navigator.serviceWorker.getRegistration())!;
      return {scope: r.scope, worker: r.active!.scriptURL, cache: r.updateViaCache};
    });
    const origin = new URL(page.url()).origin;
    expect(registration).toEqual({scope: `${origin}/`, worker: `${origin}/sw.js`, cache: 'none'});
    await context.setOffline(true);
    const failures = await page.evaluate(async () =>
      Promise.all(
        [
          '/api/pwa-probe.json',
          '/private/export.csv',
          '/index.html?synthetic=private',
          '/anything-else',
        ].map(async (path) => {
          try {
            await fetch(path);
            return false;
          } catch {
            return true;
          }
        }),
      ),
    );
    expect(failures).toEqual([true, true, true, true]);
  } finally {
    await rm(api, {force: true});
    await rm(csv, {force: true});
    await rmdir(new URL('.', api));
    await rmdir(new URL('.', csv));
  }
});
