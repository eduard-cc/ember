import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';

import {isServedShellFile, publicShellFiles} from '../../api/src/static-files.ts';

/** Build-only, finite app-shell allowlist. Never discovers or caches user data. */
export function pwaShell(): Plugin {
  let root = '';
  return {
    name: 'ember-production-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      if (config.base !== '/') throw new Error('Ember PWA requires same-origin root base /');
    },
    transformIndexHtml() {
      return [
        {tag: 'link', attrs: {rel: 'manifest', href: '/manifest.webmanifest'}, injectTo: 'head'},
      ];
    },
    generateBundle(_options, bundle) {
      if (!bundle['index.html']) throw new Error('PWA shell build requires emitted index.html');
      const names = Object.keys(bundle)
        .filter(
          (name) =>
            name === 'index.html' ||
            (name.startsWith('assets/') &&
              /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|svg|ico)$/i.test(name)),
        )
        .sort();
      // The worker's cache.addAll fails on a single 404, which leaves installed apps on the
      // old shell while health checks stay green; refuse to emit a list the server can't serve.
      const unserved = names.filter((name) => !isServedShellFile(name));
      if (unserved.length)
        throw new Error(`Production server would not serve precached ${unserved.join(', ')}`);
      const hash = createHash('sha256');
      for (const name of names) {
        const entry = bundle[name];
        hash.update(name).update(entry.type === 'chunk' ? entry.code : entry.source);
      }
      for (const name of publicShellFiles)
        hash.update(name).update(readFileSync(resolve(root, 'public', name)));
      const urls = [...names, ...publicShellFiles].map((name) => `/${name}`);
      const cache = `ember-shell-${hash.digest('hex').slice(0, 24)}`;
      // ops/lib.sh reads the `const URLS = [...];` line to check every file is served.
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
const CACHE = ${JSON.stringify(cache)};
const URLS = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS.map(url => new Request(url, {cache: 'reload'})))));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_SAVED_SHELL' && event.source?.url && new URL(event.source.url).origin === self.location.origin) {
    event.waitUntil(self.skipWaiting());
  }
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('ember-shell-') && name !== CACHE).map(name => caches.delete(name)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const path = event.request.mode === 'navigate' && url.pathname === '/' ? '/index.html' : url.pathname;
  if (!URLS.includes(path)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(path)).then(response => response || fetch(event.request)));
});
self.addEventListener('notificationclick', event => {
  if (event.notification.tag !== 'ember-active-workout') return;
  // It stays up while the workout runs. The target is fixed: the Ember window that owns the
  // draft (it answers within 300ms), else the most recent Ember window, else Ember's root.
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(windows => {
    const ours = windows.filter(client => new URL(client.url).origin === self.location.origin);
    if (!ours.length) return self.clients.openWindow('/');
    const channels = [];
    return new Promise(resolve => {
      setTimeout(() => resolve(ours[0]), 300);
      for (const client of ours) {
        const channel = new MessageChannel();
        channels.push(channel);
        channel.port1.onmessage = answer => { if (answer.data === true) resolve(client); };
        client.postMessage({type: 'EMBER_WORKOUT_OWNER'}, [channel.port2]);
      }
    }).then(client => {
      for (const channel of channels) channel.port1.close();
      client.postMessage({type: 'EMBER_RESUME_WORKOUT'});
      return client.focus();
    });
  }));
});
`,
      });
    },
  };
}
