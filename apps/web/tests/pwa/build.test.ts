import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe, expect, it} from 'vitest';

import {isServedShellFile} from '../../../api/src/static-files';
import {pwaShell} from '../../scripts/pwa-build';

function emittedWorker(bundle: Record<string, unknown>): string {
  const plugin = pwaShell();
  (plugin.configResolved as (config: {root: string; base: string}) => void)({
    root: process.cwd(),
    base: '/',
  });
  let source = '';
  (plugin.generateBundle as (...args: unknown[]) => void).call(
    {
      emitFile: (asset: {source: string}) => {
        source = asset.source;
      },
    },
    {},
    bundle,
  );
  return source;
}

function syntheticBundle(fileNames: string[]): Record<string, unknown> {
  return Object.fromEntries(
    fileNames.map((fileName) => [
      fileName,
      {type: 'asset', fileName, source: 'synthetic', names: [], originalFileNames: []},
    ]),
  );
}

function workerUrls(worker: string): string[] {
  const list = /^const URLS = (\[.*\]);$/m.exec(worker);
  if (!list) throw new Error('worker has no URLS list');
  return JSON.parse(list[1]) as string[];
}

describe('finite production shell build', () => {
  it('paints the installed app system bars in Night and starts the page chrome in Paper', () => {
    // Android fills the gesture-bar strip from the manifest only, so it must be Night to
    // avoid a light strip under the dark app; the page meta still follows the theme.
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(manifest.background_color).toBe('#17161b');
    expect(manifest.theme_color).toBe('#17161b');
    expect(readFileSync('index.html', 'utf8')).toContain(
      '<meta name="theme-color" content="#f6f1e8" />',
    );
  });
  it('fails the build rather than emitting an incomplete shell without index.html', () => {
    expect(() => emittedWorker({})).toThrow('index.html');
  });
  it('precaches only files the production server serves, including the manifest icons', () => {
    const worker = emittedWorker(
      syntheticBundle([
        'index.html',
        'assets/index-Ab_12-cd.js',
        'assets/index-Ef34.css',
        'assets/inter-latin-Gh56.woff2',
        'assets/squat-0-Ij78.webp',
      ]),
    );
    const urls = workerUrls(worker);
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
      icons: {src: string}[];
    };
    expect(urls).toEqual(
      expect.arrayContaining([
        '/index.html',
        '/assets/squat-0-Ij78.webp',
        '/manifest.webmanifest',
        '/icons/badge-96.png',
        ...manifest.icons.map((icon) => icon.src),
      ]),
    );
    for (const url of urls) expect(isServedShellFile(url.slice(1)), url).toBe(true);
  });
  it('answers a workout-notification tap by resuming the Ember window that owns the draft, else opening Ember', async () => {
    const worker = emittedWorker(syntheticBundle(['index.html']));
    const listeners: Record<string, (event: unknown) => void> = {};
    /** `owner` answers the worker's question; the other windows stay quiet, like read-only tabs. */
    const tap = async (windows: {url: string; owner?: boolean}[], tag = 'ember-active-workout') => {
      const opened: string[] = [];
      const focused: string[] = [];
      const resumed: string[] = [];
      const clients = windows.map(({url, owner}) => ({
        url,
        postMessage: (message: {type: string}, ports: MessagePort[] = []) => {
          if (message.type === 'EMBER_RESUME_WORKOUT') resumed.push(url);
          else if (message.type === 'EMBER_WORKOUT_OWNER' && owner) ports[0].postMessage(true);
        },
        focus: async () => focused.push(url),
      }));
      const self = {
        location: {origin: 'https://ember.example'},
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          (listeners[type] = listener),
        clients: {
          matchAll: async (options: unknown) => {
            expect(options).toEqual({type: 'window', includeUncontrolled: true});
            return clients;
          },
          openWindow: async (url: string) => opened.push(url),
        },
      };
      // Runs the build's own emitted worker source against a fake worker global.
      runInNewContext(worker, {self, URL, MessageChannel, setTimeout});
      let work: Promise<unknown> = Promise.resolve();
      listeners.notificationclick({
        notification: {tag, data: {url: 'https://evil.example/'}},
        waitUntil: (promise: Promise<unknown>) => (work = promise),
      });
      await work;
      return {opened, focused, resumed};
    };
    expect(
      await tap([
        {url: 'https://other.example/', owner: true},
        {url: 'https://ember.example/'},
        {url: 'https://ember.example/?x=1', owner: true},
      ]),
    ).toEqual({
      opened: [],
      focused: ['https://ember.example/?x=1'],
      resumed: ['https://ember.example/?x=1'],
    });
    // No window answers in time: the most recent Ember window is focused anyway.
    expect(await tap([{url: 'https://ember.example/a'}, {url: 'https://ember.example/b'}])).toEqual(
      {opened: [], focused: ['https://ember.example/a'], resumed: ['https://ember.example/a']},
    );
    expect(await tap([{url: 'https://other.example/'}])).toEqual({
      opened: ['/'],
      focused: [],
      resumed: [],
    });
    expect(await tap([{url: 'https://ember.example/', owner: true}], 'other')).toEqual({
      opened: [],
      focused: [],
      resumed: [],
    });
  });
  it('keeps the shared server rule to built shell files only', () => {
    for (const file of [
      'src/main.ts',
      'server/.env',
      '.env',
      'assets/.hidden.js',
      'assets/index-synthetic.js.map',
      'assets/private.csv',
      'assets/nested/index.js',
      'assets/../server/.env',
      'icons/other.png',
      'api/v1/health',
      '',
    ])
      expect(isServedShellFile(file), file).toBe(false);
  });
  it('fails the build when it emits an asset the production server would refuse', () => {
    // An unserved asset 404s in production and makes the worker's cache.addAll fail, so the
    // installed app never takes the new shell while every health check stays green.
    for (const asset of ['assets/x-ABC.png', 'assets/font-ABC.ttf', 'assets/odd.name-ABC.js'])
      expect(() => emittedWorker(syntheticBundle(['index.html', asset])), asset).toThrow(asset);
  });
  it('does not precache CSV or arbitrary JSON emitted into the asset directory', () => {
    const bundle = Object.fromEntries(
      ['index.html', 'assets/main-synthetic.js', 'assets/private.csv', 'assets/private.json'].map(
        (fileName) => [
          fileName,
          {type: 'asset', fileName, source: 'synthetic', names: [], originalFileNames: []},
        ],
      ),
    );
    const worker = emittedWorker(bundle);
    expect(worker).toContain('/index.html');
    expect(worker).toContain('/assets/main-synthetic.js');
    expect(worker).not.toContain('/assets/private.csv');
    expect(worker).not.toContain('/assets/private.json');
  });
});
