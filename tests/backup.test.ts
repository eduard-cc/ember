import 'fake-indexeddb/auto';

import {createHash} from 'node:crypto';
import {afterEach, expect, test} from 'vitest';

import {parseBackup} from '../shared/backup';
import {exportBackup, restoreBackup} from '../src/storage/backup';
import {commitStrongImport, prepareStrongImport} from '../src/storage/import';
import {WorkoutRepository} from '../src/storage/repository';

const repos: WorkoutRepository[] = [];
function repo() {
  const r = new WorkoutRepository(crypto.randomUUID());
  repos.push(r);
  return r;
}
afterEach(async () => {
  for (const r of repos.splice(0)) await r.db.delete();
});
const workout = {
  id: 'source:001',
  name: 'Synthetic',
  date: '2026-01-01T10:00:00',
  duration: 0,
  exercises: [
    {
      name: 'B',
      type: 'weighted' as const,
      sets: [
        {
          id: 'row:001',
          weight: 0,
          reps: null,
          distance: null,
          seconds: null,
          original: {Weight: '0', Reps: ''},
        },
      ],
    },
    {name: 'A', type: 'bodyweight' as const, sets: []},
  ],
};
const state = {
  version: 1 as const,
  dataset: {
    sourceLabel: 'synthetic',
    workouts: [workout],
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  },
  active: {...workout, id: 'draft'},
  finished: [],
  templates: [{...workout, id: 'template'}],
};
test('BOM Strong import preserves exact source bytes and SHA-256 through export, restore and re-export', async () => {
  const csv =
    '\uFEFFDate;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration;Notes\r\n2026-01-01 10:00:00;Synthetic BOM;Press;1;0;kg;8;;30m;synthetic\r\n';
  const bytes = new TextEncoder().encode(csv);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const prepared = await prepareStrongImport(bytes);
  expect(prepared.dataset.workouts).toHaveLength(1);
  expect(prepared.hash).toBe(hash);
  expect(prepared.hash).not.toBe(createHash('sha256').update(bytes.slice(3)).digest('hex'));
  const source = repo();
  await commitStrongImport(source, prepared, true);
  const exported = await exportBackup(source);
  const target = repo();
  await restoreBackup(target, exported);
  const reexported = await exportBackup(target);
  for (const backup of [parseBackup(exported), parseBackup(reexported)]) {
    const evidence = backup.sources.find((s) => s.key === 'hash:' + hash)!;
    expect(evidence).toBeDefined();
    expect(evidence.hash).toBe(hash);
    const retainedBytes = new TextEncoder().encode(evidence.raw!);
    expect(retainedBytes).toEqual(bytes);
    expect(createHash('sha256').update(retainedBytes).digest('hex')).toBe(evidence.hash);
    expect(evidence.workoutIds).toEqual(prepared.dataset.workouts.map((w) => w.id));
    expect(backup.state.dataset).toEqual(prepared.dataset);
  }
});
test('restore into fresh database retains source IDs, resets draft ownership and rebuilds unsent operations', async () => {
  const source = repo();
  await source.commitState(state);
  const text = await exportBackup(source);
  const target = repo();
  await restoreBackup(target, text);
  expect(await target.readState()).toEqual(state);
  const operations = await target.db.outbox.toArray();
  expect(operations.map((o) => o.entityId).sort()).toEqual(['source:001', 'template']);
  expect(operations.every((o) => o.expectedRevision === null)).toBe(true);
  expect(operations.some((o) => o.entityId === 'draft')).toBe(false);
  expect((await target.db.meta.get('installationId'))?.value).toEqual(expect.any(String));
});
test('rejects duplicate identities before any write and preserves occupied target', async () => {
  const source = repo();
  await source.commitState(state);
  const backup = parseBackup(await exportBackup(source));
  backup.state.dataset!.workouts.push(workout);
  const target = repo();
  await target.commitState(state);
  const before = await exportBackup(target);
  await expect(
    restoreBackup(target, JSON.stringify(backup), {
      replaceLocal: true,
      confirmation: 'REPLACE LOCAL DATA',
    }),
  ).rejects.toThrow();
  expect(parseBackup(await exportBackup(target)).state).toEqual(parseBackup(before).state);
});
test('replace requires exact confirmation, retains evidence and never copies old queue acknowledgements', async () => {
  const source = repo();
  await source.commitState(state);
  const oldOperationId = crypto.randomUUID();
  await source.db.outbox.put({
    operationId: oldOperationId,
    entityId: 'deleted-template',
    kind: 'deleteTemplate',
    payload: null,
    expectedRevision: 7,
  });
  const text = await exportBackup(source);
  const target = repo();
  await target.db.importSources.put({key: 'legacy-v1', value: {raw: 'immutable old bytes'}});
  await expect(restoreBackup(target, text)).rejects.toThrow('fresh');
  await expect(
    restoreBackup(target, text, {replaceLocal: true, confirmation: 'yes'}),
  ).rejects.toThrow('confirmation');
  await restoreBackup(target, text, {replaceLocal: true, confirmation: 'REPLACE LOCAL DATA'});
  expect((await target.db.importSources.get('legacy-v1'))?.value).toEqual({
    raw: 'immutable old bytes',
  });
  expect((await target.db.outbox.toArray()).some((o) => o.operationId === oldOperationId)).toBe(
    false,
  );
  expect(await target.db.syncState.count()).toBe(0);
});
test.each(['{bad', JSON.stringify({format: 'ember-backup', version: 99})])(
  'invalid JSON/schema preserves existing data: %s',
  async (text) => {
    const target = repo();
    await target.commitState(state);
    await expect(
      restoreBackup(target, text, {replaceLocal: true, confirmation: 'REPLACE LOCAL DATA'}),
    ).rejects.toThrow();
    expect(await target.readState()).toEqual(state);
  },
);
test('transaction abort retains target on a storage write failure', async () => {
  const source = repo();
  await source.commitState(state);
  const text = await exportBackup(source);
  const target = repo();
  await target.commitState(state);
  target.db.templates.hook('creating', () => {
    throw new Error('synthetic disk failure');
  });
  await expect(
    restoreBackup(target, text, {replaceLocal: true, confirmation: 'REPLACE LOCAL DATA'}),
  ).rejects.toThrow('synthetic disk failure');
  expect(await target.readState()).toEqual(state);
});
test('replacement retains immutable raw evidence even in the current dataset row', async () => {
  const source = repo();
  await source.commitState(state);
  const text = await exportBackup(source);
  const target = repo();
  await target.db.importSources.put({
    key: 'current-dataset',
    value: {dataset: null, raw: 'original source bytes'},
  });
  await restoreBackup(target, text, {replaceLocal: true, confirmation: 'REPLACE LOCAL DATA'});
  expect(
    parseBackup(await exportBackup(target)).sources.some((s) => s.raw === 'original source bytes'),
  ).toBe(true);
});
test('rejects ambiguous workout/template references and active draft collisions', async () => {
  const source = repo();
  await source.commitState(state);
  const original = await exportBackup(source);
  for (const field of ['templates', 'active'] as const) {
    const backup = parseBackup(original);
    if (field === 'templates') backup.state.templates![0].id = workout.id;
    else backup.state.active!.id = workout.id;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('Duplicate');
  }
});
test('versioned export preserves complete domain and immutable original evidence without sessions', async () => {
  const r = repo();
  await r.commitState(state);
  await r.db.importSources.put({key: 'unreadable-legacy', value: {raw: '{broken'}});
  await r.db.meta.put({key: 'installationId', value: 'origin'});
  await r.db.syncState.put({key: 'session', value: 'SECRET'});
  const text = await exportBackup(r);
  const backup = parseBackup(text);
  expect(backup.state).toEqual(state);
  expect(backup.sources).toContainEqual({
    key: 'unreadable-legacy',
    raw: '{broken',
    hash: null,
    workoutIds: [],
  });
  expect(backup.draftOwnership).toEqual({
    installationId: 'origin',
    policy: 'local-only-deliberate-restore',
  });
  expect(text).not.toContain('SECRET');
  expect(backup.pendingOperations.label).toBe('diagnostic-only-not-restored');
});
