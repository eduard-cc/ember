import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import {expect, it} from 'vitest';

import {demoDataset, demoTemplates} from '../src/domain/demo';
import {migrateLegacy} from '../src/storage/migrate-legacy';
import {WorkoutRepository} from '../src/storage/repository';

const state = {
  version: 1,
  dataset: demoDataset,
  active: {...demoTemplates[0], id: 'demo-draft-preserve-without-owner-confirmation'},
  finished: [{...demoDataset.workouts[0], id: 'native-finished'}],
  templates: demoTemplates,
};
it.each([
  '{broken-json',
  JSON.stringify({...state, version: 2}),
  JSON.stringify({
    ...state,
    active: {
      ...state.active,
      exercises: [
        {
          ...state.active.exercises[0],
          sets: [{...state.active.exercises[0].sets[0], weight: '30'}],
        },
      ],
    },
  }),
  JSON.stringify({
    ...state,
    dataset: {...state.dataset, warnings: {...state.dataset.warnings, duplicateRows: -1}},
  }),
  JSON.stringify({...state, templates: [{...state.templates[0], unexpected: true}]}),
  JSON.stringify({...state, active: {...state.active, date: '2026-02-30T12:00:00'}}),
  JSON.stringify({...state, finished: [{...state.finished[0], duration: -1}]}),
])('blocks unsupported or malformed complete state without any writes (case %#)', async (raw) => {
  const repository = new WorkoutRepository(`migration-${crypto.randomUUID()}`);
  expect(await migrateLegacy(repository, raw)).toBe('blocked');
  expect(await repository.db.meta.count()).toBe(0);
  expect(await repository.db.drafts.count()).toBe(0);
  expect(await repository.db.workouts.count()).toBe(0);
  expect(await repository.db.importSources.count()).toBe(0);
  repository.close();
});
it('preserves original strings, unusual raw values, repeated exercise occurrences and document order', async () => {
  const repository = new WorkoutRepository(`migration-${crypto.randomUUID()}`);
  const workout = {
    ...state.finished[0],
    id: 'z-original',
    date: '2025-01-01T12:00:00',
    exercises: [
      {
        name: 'Repeated variant',
        type: 'weighted' as const,
        sets: [
          {
            id: 'csv-row-8',
            weight: 0,
            reps: null,
            seconds: -1,
            distance: 0.5,
            original: {Weight: '0.00', Reps: '', Notes: 'line 1\nline 2'},
          },
        ],
      },
      {
        name: 'Repeated variant',
        type: 'weighted' as const,
        sets: [
          {
            id: 'csv-row-9',
            weight: -2.5,
            reps: 3.5,
            seconds: null,
            distance: null,
            original: {Weight: '-2,5', Reps: '3.5'},
          },
        ],
      },
    ],
  };
  const complete = {
    ...state,
    active: workout,
    finished: [workout, {...state.finished[0], id: 'a-original'}],
    dataset: {...state.dataset, workouts: [workout]},
    templates: [{...workout, date: ''}],
  };
  expect(await migrateLegacy(repository, JSON.stringify(complete))).toBe('migrated');
  expect(await repository.readState()).toEqual(complete);
  repository.close();
});
it('retries an interrupted real transaction without partial documents or duplicates', async () => {
  const repository = new WorkoutRepository(`migration-${crypto.randomUUID()}`);
  const raw = JSON.stringify(state);
  const interrupt = () => {
    Dexie.currentTransaction?.abort();
  };
  repository.db.importSources.hook('creating', interrupt);
  await expect(migrateLegacy(repository, raw)).rejects.toThrow();
  expect(await repository.db.drafts.count()).toBe(0);
  expect(await repository.db.workouts.count()).toBe(0);
  expect(await repository.db.templates.count()).toBe(0);
  expect(await repository.db.meta.count()).toBe(0);
  repository.db.importSources.hook('creating').unsubscribe(interrupt);
  repository.close();
  const reopened = new WorkoutRepository(repository.db.name);
  expect(await migrateLegacy(reopened, raw)).toBe('migrated');
  expect(await reopened.readState()).toEqual(state);
  expect(await migrateLegacy(reopened, raw)).toBe('none');
  reopened.close();
});
it('migrates every legacy document and occurrence once with exact original bytes retained', async () => {
  const repository = new WorkoutRepository(`migration-${crypto.randomUUID()}`);
  const raw = JSON.stringify(state, null, 2);
  expect(await migrateLegacy(repository, raw)).toBe('migrated');
  expect(await repository.readDraft()).toEqual(state.active);
  expect(await repository.db.workouts.toArray()).toEqual(state.finished);
  expect(await repository.db.templates.toArray()).toEqual(
    [...state.templates].sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect((await repository.db.importSources.get('legacy-v1'))?.value).toEqual({
    raw,
    dataset: state.dataset,
  });
  expect(await migrateLegacy(repository, raw)).toBe('none');
  expect(await repository.db.workouts.count()).toBe(1);
  repository.close();
});
it('opens an installation whose stored sets carry the retired review flags, dropping only those flags', async () => {
  const name = `migration-${crypto.randomUUID()}`;
  const flagged = {
    ...state.finished[0],
    id: 'flagged',
    exercises: [
      {
        name: 'Press',
        type: 'weighted' as const,
        sets: [
          {
            id: 'csv-row-1',
            weight: 500,
            reps: 120,
            seconds: null,
            distance: null,
            excluded: true,
            suspicious: true,
            original: {Weight: '500', Reps: '120'},
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify({...state, dataset: {...state.dataset, workouts: [flagged]}});
  // The store as an earlier app version wrote it.
  const older = new Dexie(name);
  older.version(1).stores({
    meta: '&key',
    drafts: '&key',
    workouts: '&id',
    templates: '&id',
    outbox: '&operationId',
    syncState: '&key',
    importSources: '&key',
  });
  older.version(2).stores({bodyWeights: '&id'});
  const dataset = {
    ...state.dataset,
    warnings: {...state.dataset.warnings, suspiciousRows: 1},
    workouts: [flagged],
  };
  await older.table('workouts').add(flagged);
  await older.table('templates').add({...flagged, id: 'template', date: ''});
  await older.table('drafts').add({key: 'active', workout: {...flagged, id: 'draft'}});
  await older.table('outbox').add({
    operationId: crypto.randomUUID(),
    entityId: 'flagged',
    kind: 'putWorkout',
    expectedRevision: null,
    payload: flagged,
  });
  await older.table('importSources').bulkAdd([
    {key: 'legacy-v1', value: {raw, dataset}},
    {key: 'imported:flagged', value: flagged},
  ]);
  await older.table('meta').put({key: 'imported-sync-active', value: true});
  older.close();

  const repository = new WorkoutRepository(name);
  const set = {...flagged.exercises[0].sets[0]} as Partial<
    (typeof flagged.exercises)[0]['sets'][0]
  >;
  delete set.excluded;
  delete set.suspicious;
  const clean = {...flagged, exercises: [{...flagged.exercises[0], sets: [set]}]};
  const loaded = await repository.readState();
  expect(loaded.finished).toEqual([clean]);
  expect(loaded.templates).toEqual([{...clean, id: 'template', date: ''}]);
  expect(loaded.active).toEqual({...clean, id: 'draft'});
  expect(loaded.dataset?.workouts).toEqual([clean]);
  expect(loaded.dataset?.warnings).toEqual(state.dataset.warnings);
  expect((await repository.db.outbox.toArray())[0].payload).toEqual(clean);
  expect(await repository.db.workouts.get('flagged')).toEqual(clean);
  expect(await repository.db.importSources.get('imported:flagged')).toEqual({
    key: 'imported:flagged',
    value: clean,
  });
  // The original legacy bytes are evidence and stay exactly as written.
  expect(await repository.db.importSources.get('legacy-v1')).toEqual({
    key: 'legacy-v1',
    value: {raw, dataset: {...state.dataset, workouts: [clean]}},
  });
  repository.close();
});
