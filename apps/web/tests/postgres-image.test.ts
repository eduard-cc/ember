import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

// The backup scripts refuse to run unless the live container uses exactly the pinned image,
// so every pin must move together, and CI must test the image that production runs.
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const pins = (path: string) =>
  [...read(path).matchAll(/postgres:(\d+\.\d+-bookworm)/g)].map((m) => m[1]);

describe('PostgreSQL image pin', () => {
  it('is the same exact minor everywhere', () => {
    const [live] = pins('ops/compose.local.yml');
    expect(live).toMatch(/^17\.\d+-bookworm$/);
    for (const path of [
      'ops/compose.local.yml',
      'ops/backup.sh',
      'ops/restore-check.sh',
      'ops/image-smoke.sh',
      '.github/workflows/ci.yml',
    ]) {
      expect(pins(path), path).toEqual([live]);
    }
  });
});
