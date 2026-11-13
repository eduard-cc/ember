import decode, {init} from '@jsquash/webp/decode.js';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';

import {bodyParts, bodyPartsOf, catalog, catalogEntry, muscles} from '../src/catalog/catalog';

// 5th to 95th percentile of the licensed drawings' line width before normalisation
// (scripts/catalog/README.md, "Line width").
const strokeBand = [1.7, 2.7];

/** Mean line width (px) of a drawing: 2 × ink area ÷ outline length. The outline is measured
 * with Crofton's formula over four directions, so diagonal lines count like straight ones.
 * Ink is alpha above half. Same measure as `stroke_width` in scripts/catalog/stroke.py. */
function strokeWidth({width, height, data}: ImageData) {
  const ink = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] > 127;
  let area = 0;
  const crossings = [0, 0, 0, 0];
  for (let y = -1; y < height; y++)
    for (let x = -1; x < width; x++) {
      const here = ink(x, y);
      if (here) area++;
      if (here !== ink(x + 1, y)) crossings[0]++;
      if (here !== ink(x, y + 1)) crossings[1]++;
      if (here !== ink(x + 1, y + 1)) crossings[2]++;
      if (ink(x + 1, y) !== ink(x, y + 1)) crossings[3]++;
    }
  const [across, down, diagonal, antidiagonal] = crossings;
  const outline = (Math.PI / 8) * (across + down + (diagonal + antidiagonal) / Math.SQRT2);
  return (2 * area) / outline;
}

// Names as a Strong export writes them, so imported history maps 1:1 without renaming.
const strongNames = [
  'Bench Press (Barbell)',
  'Squat (Barbell)',
  'Bicep Curl (Dumbbell)',
  'Pull Up (Assisted)',
  'Lat Pulldown (Cable)',
  'Plank',
];
const entryFields = [
  'name',
  'bodyPart',
  'equipment',
  'type',
  'primaryMuscles',
  'secondaryMuscles',
  'images',
  'sources',
];

describe('bundled exercise catalog', () => {
  it('names exercises as a Strong export does, each once, with the same fields on every entry', () => {
    for (const name of strongNames) expect(catalogEntry(name)?.name).toBe(name);
    for (const entry of catalog) expect(Object.keys(entry).sort()).toEqual([...entryFields].sort());
    expect(new Set(catalog.map((e) => e.name)).size).toBe(catalog.length);
    expect(catalog.length).toBeGreaterThanOrEqual(150);
    expect(catalog.length).toBeLessThanOrEqual(300);
  });
  it('lists exercises by body part, then name, and the muscle table by name', () => {
    const key = (e: (typeof catalog)[number]) =>
      `${String(bodyParts.indexOf(e.bodyPart)).padStart(2, '0')} ${e.name}`;
    const keys = catalog.map(key);
    expect(keys).toEqual([...keys].sort());
    const table = Object.keys(
      JSON.parse(readFileSync('scripts/catalog/muscles.json', 'utf8')) as object,
    );
    expect(table).toEqual([...table].sort());
  });
  it('offers only the body parts its exercises belong to, Other only for names outside the catalog', () => {
    const parts = bodyPartsOf(catalog.map((e) => e.name));
    expect(parts).toEqual([
      'Chest',
      'Back',
      'Shoulders',
      'Arms',
      'Legs',
      'Core',
      'Cardio',
      'Full body',
    ]);
    expect(bodyPartsOf(['Plank', 'Synthetic Sled Drag'])).toEqual(['Core', 'Other']);
  });
  it('tags every exercise with its reviewed primary and secondary muscles', () => {
    const table = JSON.parse(readFileSync('scripts/catalog/muscles.json', 'utf8')) as Record<
      string,
      {primary: string[]; secondary: string[]}
    >;
    expect(Object.keys(table).sort()).toEqual(catalog.map((e) => e.name).sort());
    for (const exercise of catalog) {
      const {primaryMuscles: primary, secondaryMuscles: secondary} = exercise;
      expect({primary, secondary}, exercise.name).toEqual(table[exercise.name]);
      expect(primary.length, exercise.name).toBeGreaterThan(0);
      for (const muscle of [...primary, ...secondary]) expect(muscles).toContain(muscle);
      expect(
        primary.filter((m) => secondary.includes(m)),
        exercise.name,
      ).toEqual([]);
      expect(exercise.sources.map((s) => s.kind)).not.toContain('muscles');
    }
    expect(catalogEntry('Hip Adductor (Machine)')?.primaryMuscles).toEqual(['Adductors']);
    expect(catalogEntry('Shrug (Dumbbell)')?.primaryMuscles).toEqual(['Traps']);
    expect(catalogEntry('Lateral Raise (Dumbbell)')?.primaryMuscles).toEqual(['Side delts']);
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
        // Attribution names the author and links the source; contact addresses are not needed.
        expect(source.author).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        expect(source.license).toMatch(/^(CC BY-SA [34]\.0|CC0 1\.0|app-owned)$/);
        if (source.license === 'app-owned') {
          expect(source.kind).toBe('illustration');
          expect(source.author).toBe('Ember (AI-assisted, gpt-image-2)');
          expect(source.changes).toContain('AI-assisted illustration');
          expect(source.changes).toContain('not an Everkinetic or wger work');
          expect(`${source.author} ${source.url} ${source.licenseUrl}`).not.toMatch(
            /everkinetic|wger/i,
          );
          // Provenance links point at the catalog README in this repository and its section.
          const readme = /^https:\/\/github\.com\/eduard-cc\/ember\/blob\/main\/(.+)$/.exec(
            source.url,
          )?.[1];
          expect(readme && existsSync(`../../${readme}`)).toBe(true);
          expect(readFileSync(`../../${readme}`, 'utf8')).toContain(
            '\n## App-owned illustrations\n',
          );
          expect(source.licenseUrl).toBe(`${source.url}#app-owned-illustrations`);
        }
        expect(source.url).toMatch(/^https:\/\//);
      }
      for (const image of exercise.images) {
        const path = `src/catalog/images/${image.file}`;
        expect(existsSync(path)).toBe(true);
        expect(statSync(path).size).toBeLessThanOrEqual(40 * 1024);
      }
    }
  });
  it('shows every AI-assisted drawing as a start/finish pair, except holds without a progression', () => {
    const appOwned = catalog.filter((e) => e.sources.some((s) => s.license === 'app-owned'));
    const singles = appOwned.filter((e) => e.images.length === 1).map((e) => e.name);
    expect(singles).toEqual(['Plank']);
    for (const entry of appOwned.filter((e) => e.name !== 'Plank'))
      expect(entry.images.map((i) => i.file)).toEqual(
        [0, 1].map((n) => entry.images[0].file.replace(/-\d+\.webp$/, `-${n}.webp`)),
      );
    // Both poses of a pair are hash-pinned to the reviewed source PNGs.
    const manifest = JSON.parse(
      readFileSync('scripts/catalog/generated-manifest.json', 'utf8'),
    ) as {
      exercises: {name: string; status: string; startSha256?: string}[];
    };
    for (const item of manifest.exercises.filter((e) => e.status === 'accepted')) {
      if (item.name === 'Plank') expect(item.startSha256).toBeUndefined();
      else expect(item.startSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it('bundles exactly the accepted AI-assisted drawings with only one illustration source', () => {
    const manifest = JSON.parse(
      readFileSync('scripts/catalog/generated-manifest.json', 'utf8'),
    ) as {
      exercises: {name: string; status: string; sha256?: string}[];
    };
    const accepted = manifest.exercises.filter((e) => e.status === 'accepted');
    expect(accepted.length).toBeGreaterThan(0);
    for (const item of accepted) expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
    const appOwned = catalog.filter((e) => e.sources.some((s) => s.license === 'app-owned'));
    expect(appOwned.map((e) => e.name).sort()).toEqual(accepted.map((e) => e.name).sort());
    for (const entry of appOwned) {
      const illustrations = entry.sources.filter((s) => s.kind === 'illustration');
      expect(illustrations).toEqual([
        expect.objectContaining({
          author: 'Ember (AI-assisted, gpt-image-2)',
          license: 'app-owned',
        }),
      ]);
    }
    // Rejected or unreviewed drawings never ship.
    for (const item of manifest.exercises.filter((e) => e.status !== 'accepted'))
      expect(catalogEntry(item.name)?.sources.some((s) => s.license === 'app-owned')).toBe(false);
  });
  it('keeps licensed drawings attributed to their original authors', () => {
    const licensed = catalog.filter((e) =>
      e.sources.some((s) => s.kind === 'illustration' && s.license !== 'app-owned'),
    );
    // Everkinetic's unpublished drawings (same artist and licence) cover these exercises.
    for (const name of [
      'Ab Wheel',
      'Cable Crunch',
      'Hanging Knee Raise',
      'Russian Twist',
      'Woodchopper (Cable)',
    ])
      expect(catalogEntry(name)?.sources, name).toEqual([
        expect.objectContaining({
          kind: 'illustration',
          author: 'Everkinetic',
          license: 'CC BY-SA 4.0',
          url: 'https://github.com/everkinetic/data',
          changes: 'cropped, resized, recoloured and line width normalised',
        }),
      ]);
    expect(licensed.length).toBeGreaterThanOrEqual(164);
    for (const entry of licensed)
      expect(entry.sources.some((s) => s.license === 'app-owned')).toBe(false);
  });
  it('shows each exercise its own movement, not a neighbouring variant', () => {
    // Lying Leg Raise uses Everkinetic's Flat Bench Leg Raises drawing.
    const legRaise = catalogEntry('Lying Leg Raise');
    expect(legRaise?.sources.find((s) => s.kind === 'illustration')?.title).toBe(
      'Flat Bench Leg Raises',
    );
    // Assisted pull-ups show the assisted machine, not the unassisted pull-up drawing.
    const assisted = catalogEntry('Pull Up (Assisted)');
    expect(assisted?.sources.find((s) => s.kind === 'illustration')?.license).toBe('app-owned');
  });
  it('draws every drawing with the line width of the licensed Everkinetic set', async () => {
    // The package's types declare only Emscripten options; its init also takes a compiled module.
    const initDecoder = init as unknown as (module: WebAssembly.Module) => Promise<void>;
    await initDecoder(
      new WebAssembly.Module(
        readFileSync(
          createRequire(import.meta.url).resolve('@jsquash/webp/codec/dec/webp_dec.wasm'),
        ),
      ),
    );
    const outside: string[] = [];
    for (const image of catalog.flatMap((e) => e.images)) {
      const bytes = readFileSync(`src/catalog/images/${image.file}`);
      const width = strokeWidth(await decode(new Uint8Array(bytes).buffer));
      if (!(width >= strokeBand[0] && width <= strokeBand[1]))
        outside.push(`${image.file}: ${width.toFixed(2)}px`);
    }
    expect(outside).toEqual([]);
  });
  it('gives every exercise a drawing', () => {
    expect(catalog.filter((e) => e.images.length === 0).map((e) => e.name)).toEqual([]);
  });
  it('keeps unclear-copyright datasets out of the committed catalog', () => {
    const raw = readFileSync('src/catalog/exercises.json', 'utf8');
    expect(raw).not.toMatch(/exercisedb|free-exercise-db|wrkout|exrx|mens fitness|men's fitness/i);
  });
});
