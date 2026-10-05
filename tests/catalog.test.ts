import {existsSync, readFileSync, statSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {catalog, catalogEntry} from '../src/catalog/catalog';

// Names as a Strong export writes them, so imported history maps 1:1 without renaming.
const strongNames = [
  'Bench Press (Barbell)',
  'Squat (Barbell)',
  'Bicep Curl (Dumbbell)',
  'Pull Up (Assisted)',
  'Lat Pulldown (Cable)',
  'Plank',
];

describe('bundled exercise catalog', () => {
  it('contains the Strong names exactly once and a curated common set', () => {
    for (const name of strongNames) expect(catalogEntry(name)?.name).toBe(name);
    expect(new Set(catalog.map((e) => e.name)).size).toBe(catalog.length);
    expect(catalog.length).toBeGreaterThanOrEqual(150);
    expect(catalog.length).toBeLessThanOrEqual(300);
  });
  it('types assisted work as assistance so no strength formula applies', () => {
    for (const name of ['Pull Up (Assisted)', 'Triceps Dip (Assisted)', 'Chest Dip (Assisted)'])
      expect(catalogEntry(name)?.type).toBe('assisted');
  });
  it('attributes every bundled drawing and keeps each asset small', () => {
    for (const exercise of catalog) {
      if (exercise.images.length)
        expect(exercise.sources.some((s) => s.kind === 'illustration')).toBe(true);
      for (const source of exercise.sources) {
        expect(source.author).toBeTruthy();
        expect(source.license).toMatch(/^(CC BY-SA [34]\.0|CC0 1\.0)$/);
        expect(source.url).toMatch(/^https:\/\//);
      }
      for (const image of exercise.images) {
        const path = `src/catalog/images/${image.file}`;
        expect(existsSync(path)).toBe(true);
        expect(statSync(path).size).toBeLessThanOrEqual(40 * 1024);
      }
    }
  });
  it('keeps unclear-copyright datasets out of the committed catalog', () => {
    const raw = readFileSync('src/catalog/exercises.json', 'utf8');
    expect(raw).not.toMatch(/exercisedb|free-exercise-db|wrkout|exrx|mens fitness|men's fitness/i);
  });
});
