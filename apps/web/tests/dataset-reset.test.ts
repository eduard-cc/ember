import 'fake-indexeddb/auto';

import {expect, it} from 'vitest';

import {WorkoutRepository} from '../src/storage/repository';
import {DatasetReset, SyncEngine} from '../src/sync/engine';

const workout = (id: string) => ({
  id,
  name: 'Synthetic',
  date: '2026-01-01T12:00:00',
  duration: 0,
  exercises: [
    {
      name: 'Press',
      type: 'weighted' as const,
      sets: [
        {id: id + ':set', weight: 20, reps: 8, seconds: null, distance: null, completed: true},
      ],
    },
  ],
});

it('a server reset drops synced copies but keeps the draft and unsent finished workouts', async () => {
  const repo = new WorkoutRepository('reset-' + crypto.randomUUID());
  const db = repo.db;
  await db.meta.put({key: 'dataset-epoch', value: 'initial'});
  await db.meta.put({key: 'imported-sync-active', value: true});
  await db.importSources.put({key: 'imported:old', value: workout('old')});
  await db.importSources.put({key: 'current-dataset', value: {dataset: null}});
  await db.workouts.put(workout('synced'));
  await db.syncState.put({key: 'revision:synced', value: 1});
  await db.syncState.put({key: 'cursor', value: 40});
  await db.templates.put(workout('template'));
  await repo.queueOperation('putTemplate', 'template', workout('template'));
  // Finished offline after the last sync: real new training that the server never saw.
  await repo.commitDraft(workout('unsent'));
  await repo.finishWorkout(workout('unsent'));
  await repo.commitDraft(workout('draft'));

  await repo.resetToEpoch('epoch-2');

  const state = await repo.readState();
  expect(state.active?.id).toBe('draft');
  expect(state.finished.map((w) => w.id)).toEqual(['unsent']);
  expect(state.templates).toEqual([]);
  expect(state.dataset?.workouts ?? []).toEqual([]);
  expect((await db.meta.get('dataset-epoch'))?.value).toBe('epoch-2');
  expect((await db.syncState.get('cursor'))?.value).toBeUndefined();
  const outbox = await db.outbox.toArray();
  expect(outbox.map((o) => [o.entityId, o.kind, o.expectedRevision])).toEqual([
    ['unsent', 'putWorkout', null],
  ]);
  // Re-bootstrapping must not resurrect purged legacy history.
  await repo.bootstrapSync();
  expect((await db.outbox.toArray()).map((o) => o.entityId)).toEqual(['unsent']);
  repo.close();
});

it('reset preserves never-acknowledged legacy finishes and archives offline edits and source evidence', async () => {
  const repo = new WorkoutRepository('reset-' + crypto.randomUUID());
  const db = repo.db;
  await db.workouts.put(workout('legacy-unsent'));
  await db.meta.put({key: 'finished-order', value: ['legacy-unsent']});
  await db.importSources.put({key: 'legacy-bytes', value: 'synthetic original bytes'});
  await db.templates.put(workout('offline-template'));
  await repo.queueOperation('putTemplate', 'offline-template', workout('offline-template'));
  await db.syncState.put({key: 'issue:old', value: {errorCode: 'REVISION_CONFLICT'}});
  const oldOperations = await db.outbox.toArray();

  await repo.resetToEpoch('epoch-2');

  expect((await repo.readState()).finished.map((w) => w.id)).toEqual(['legacy-unsent']);
  const archives = (await db.meta.toArray()).filter((r) =>
    r.key.startsWith('dataset-reset-archive:'),
  );
  expect(archives).toHaveLength(1);
  expect(archives[0].value).toMatchObject({
    importSources: [{key: 'legacy-bytes', value: 'synthetic original bytes'}],
    templates: [workout('offline-template')],
    outbox: oldOperations,
    syncState: expect.arrayContaining([
      {key: 'issue:old', value: {errorCode: 'REVISION_CONFLICT'}},
    ]),
  });
  expect((await db.outbox.toArray()).map((o) => o.entityId)).toEqual(['legacy-unsent']);
  repo.close();
});

it('the engine sends its epoch and reports a reset instead of pushing stale history', async () => {
  const repo = new WorkoutRepository('reset-' + crypto.randomUUID());
  await repo.db.meta.put({key: 'dataset-epoch', value: 'initial'});
  await repo.commitDraft(workout('unsent'));
  await repo.finishWorkout(workout('unsent'));
  const seen: (string | null)[] = [];
  const engine = new SyncEngine(repo, async (_url, init) => {
    seen.push(new Headers(init?.headers).get('X-Dataset-Epoch'));
    return new Response(JSON.stringify({errorCode: 'DATASET_RESET', epoch: 'epoch-2'}), {
      status: 409,
    });
  });
  const error = await engine.sync({ownerId: 'owner', csrfToken: 't'}).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DatasetReset);
  expect((error as DatasetReset).epoch).toBe('epoch-2');
  expect(seen).toEqual(['initial']);
  expect(await repo.db.outbox.count()).toBe(1);
  repo.close();
});
