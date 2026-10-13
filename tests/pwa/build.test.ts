import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

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
