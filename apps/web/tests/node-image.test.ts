import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

// The production image and CI's setup-node both follow the root .nvmrc, so the app is
// tested on the Node major it runs. Dependabot moves the tag and digest together.
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('Node image pin', () => {
  it('is one exact, digest-pinned release of the .nvmrc major', () => {
    const froms = [...read('Dockerfile').matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    const pinned = froms.filter((image) => image.startsWith('node:'));
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatch(/^node:\d+\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/);
    expect(pinned[0].split(/[:.]/)[1]).toBe(read('.nvmrc').trim());
    // Every other stage builds on the pinned one.
    expect(froms.slice(1)).toEqual(froms.slice(1).map(() => 'base'));
  });
});
