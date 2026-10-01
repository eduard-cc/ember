import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';

const publicShell = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

/** Build-only, finite app-shell allowlist. Never discovers or caches user data. */
export function pwaShell(): Plugin {
  let root = '';
  return {
    name: 'gym-log-production-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      if (config.base !== '/') throw new Error('Gym Log PWA requires same-origin root base /');
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
      const hash = createHash('sha256');
      for (const name of names) {
        const entry = bundle[name];
        hash.update(name).update(entry.type === 'chunk' ? entry.code : entry.source);
      }
      for (const name of publicShell)
        hash.update(name).update(readFileSync(resolve(root, 'public', name)));
      const urls = [...names, ...publicShell].map((name) => `/${name}`);
      const cache = `gym-log-shell-${hash.digest('hex').slice(0, 24)}`;
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
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('gym-log-shell-') && name !== CACHE).map(name => caches.delete(name)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const path = event.request.mode === 'navigate' && url.pathname === '/' ? '/index.html' : url.pathname;
  if (!URLS.includes(path)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(path)).then(response => response || fetch(event.request)));
});
`,
      });
    },
  };
}
