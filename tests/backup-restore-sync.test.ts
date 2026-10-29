import 'fake-indexeddb/auto';

import {afterEach, expect, test} from 'vitest';

import {parseBackup} from '../shared/backup';
import {exportBackup, restoreBackup} from '../src/storage/backup';
import {WorkoutRepository} from '../src/storage/repository';

const repositories: WorkoutRepository[] = [];
const repo = () => {
  const r = new WorkoutRepository(crypto.randomUUID());
  repositories.push(r);
  return r;
};
afterEach(async () => {
  for (const r of repositories.splice(0)) await r.db.delete();
});
const workout = {
  id: 'import:new',
  name: 'Synthetic',
  date: '2026-01-01T10:00:00',
  duration: 0,
  exercises: [],
};
const state = {
  version: 1 as const,
  dataset: {
    sourceLabel: 'Synthetic CSV',
    workouts: [workout],
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  },
  active: null,
  finished: [],
  templates: [],
};
test('export provenance retains owner, real revisions/cursor and hash metadata but restore never trusts revisions', async () => {
  const source = repo();
  await source.commitState(state);
  await source.db.meta.put({key: 'ownerId', value: 'owner'});
  await source.db.syncState.bulkPut([
    {key: 'cursor', value: 12},
    {key: 'revision:' + workout.id, value: 3},
    {key: 'session', value: 'SECRET'},
  ]);
  const hash = 'b'.repeat(64);
  await source.db.importSources.put({
    key: 'hash:' + hash,
    value: {hash, raw: 'synthetic bytes', workoutIds: [workout.id]},
  });
  const text = await exportBackup(source);
  const backup = JSON.parse(text);
  expect(backup.provenance).toEqual({
    ownerId: 'owner',
    cursor: 12,
    revisions: [{entityId: workout.id, revision: 3}],
  });
  expect(backup.sources).toContainEqual({
    key: 'hash:' + hash,
    raw: 'synthetic bytes',
    hash,
    workoutIds: [workout.id],
  });
  expect(text).not.toContain('SECRET');
  const target = repo();
  await restoreBackup(target, text);
  expect((await target.db.meta.get('ownerId'))?.value).toBe('owner');
  expect((await target.db.meta.get('local-trust'))?.value).toBe(false);
  expect(await target.db.syncState.count()).toBe(0);
  expect((await target.db.outbox.toArray())[0].expectedRevision).toBeNull();
  expect((await target.db.importSources.get('hash:' + hash))?.value).toEqual({
    raw: 'synthetic bytes',
    hash,
    workoutIds: [workout.id],
  });
  for (const provenance of [
    undefined,
    {...backup.provenance, csrfToken: 'secret'},
    {...backup.provenance, cursor: -1},
    {...backup.provenance, revisions: [{entityId: workout.id, revision: 0}]},
  ])
    expect(() => parseBackup(JSON.stringify({...backup, provenance}))).toThrow();
});
test('strict source schema rejects working-index injection and inconsistent source metadata before writes', async () => {
  const source = repo();
  await source.commitState(state);
  const backup = parseBackup(await exportBackup(source));
  const target = repo();
  await target.commitState(state);
  for (const key of ['imported:forged', 'hash:' + 'c'.repeat(64)]) {
    const invalid = {
      ...backup,
      sources: [{key, raw: 'forged working index', hash: null, workoutIds: []}],
    };
    await expect(
      restoreBackup(target, JSON.stringify(invalid), {
        replaceLocal: true,
        confirmation: 'REPLACE LOCAL DATA',
      }),
    ).rejects.toThrow();
    expect(await target.readState()).toEqual(state);
  }
});
test('replacement restores only the new imported index and create-only imported operations', async () => {
  const source = repo();
  await source.commitState(state);
  const target = repo();
  await target.db.importSources.put({key: 'imported:old', value: {...workout, id: 'old'}});
  await target.db.importSources.put({
    key: 'hash:' + 'a'.repeat(64),
    value: {hash: 'a'.repeat(64), raw: 'old raw', workoutIds: ['old']},
  });
  await target.db.meta.put({key: 'imported-sync-active', value: true});
  await restoreBackup(target, await exportBackup(source), {
    replaceLocal: true,
    confirmation: 'REPLACE LOCAL DATA',
  });
  await target.bootstrapSync();
  expect(await target.readState()).toEqual(state);
  expect(await target.db.outbox.toArray()).toEqual([
    expect.objectContaining({
      entityId: workout.id,
      kind: 'putImportedWorkout',
      expectedRevision: null,
    }),
  ]);
  expect((await target.db.importSources.get('current-dataset'))?.value).toEqual({
    dataset: state.dataset,
  });
  expect((await target.db.meta.get('imported-sync-active'))?.value).toBe(true);
  expect(await target.db.importSources.get('hash:' + 'a'.repeat(64))).toBeUndefined();
  expect(parseBackup(await exportBackup(target)).sources.some((s) => s.raw === 'old raw')).toBe(
    true,
  );
});
