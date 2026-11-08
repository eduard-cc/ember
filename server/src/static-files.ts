// The only built web files the production server sends. Pure and dependency-free so the
// web build (scripts/pwa-build.ts) can import it: every URL the service worker precaches
// must pass this rule, or its install fails and the app keeps a stale shell.
const shellAsset = /^assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2|webp)$/;

/** Files from public/ that the offline shell needs besides the build output. */
export const publicShellFiles: readonly string[] = Object.freeze([
	'manifest.webmanifest',
	'icons/icon-192.png',
	'icons/icon-512.png',
	'icons/apple-touch-icon.png',
	'icons/favicon.svg',
]);

/** `file` is a web-root-relative path without a leading slash, e.g. `assets/index-Ab12.js`. */
export function isServedShellFile(file: string): boolean {
	return file === 'index.html' || file === 'sw.js' || publicShellFiles.includes(file) || shellAsset.test(file);
}
