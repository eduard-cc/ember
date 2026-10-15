import 'fake-indexeddb/auto';

import {expect, it} from 'vitest';

import type {Workout} from '../src/domain/types';
import {WorkoutRepository} from '../src/storage/repository';
import {SyncEngine} from '../src/sync/engine';

const workout = {
  id: 'native',
  name: 'Test',
  date: '2026-01-01T12:00:00',
  duration: 0,
  exercises: [
    {
      name: 'Press',
      type: 'weighted' as const,
      sets: [{id: 'set', weight: 20, reps: 8, seconds: null, distance: null, completed: true}],
    },
  ],
};
it('keeps immutable pending operation when acknowledgement identity does not match', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  await repo.commitDraft(workout);
  await repo.finishWorkout(workout);
  const before = await repo.db.outbox.toArray();
  const engine = new SyncEngine(
    repo,
    async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              operationId: before[0].operationId,
              entityId: 'other',
              status: 'accepted',
              revision: 1,
              changeSeq: 1,
            },
          ],
        }),
        {status: 200},
      ),
  );
  await expect(engine.sync({ownerId: 'owner', csrfToken: 'test'})).rejects.toThrow();
  expect(await repo.db.outbox.toArray()).toEqual(before);
  repo.close();
});
it('applies a validated change page atomically without modifying the local draft', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  await repo.commitDraft(workout);
  const peer = {...workout, id: 'peer'};
  const engine = new SyncEngine(
    repo,
    async () =>
      new Response(
        JSON.stringify({
          changes: [
            {entityId: 'peer', kind: 'putWorkout', revision: 1, changeSeq: 1, payload: peer},
          ],
          nextCursor: 1,
          hasMore: false,
        }),
      ),
  );
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect((await repo.readState()).finished).toEqual([peer]);
  expect(await repo.readDraft()).toEqual(workout);
  expect((await repo.db.syncState.get('cursor'))?.value).toBe(1);
  repo.close();
});
it('queues offline template edits in projected revision order with immutable payloads', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  let state = await repo.readState();
  state = {...state, templates: [workout]};
  await repo.commitState(state);
  state = {...state, templates: [{...workout, name: 'Edited'}]};
  await repo.commitState(state);
  state = {...state, templates: []};
  await repo.commitState(state);
  const order = (await repo.db.syncState.get('queue-order'))?.value as string[];
  const pending = await Promise.all(order.map((id) => repo.db.outbox.get(id)));
  expect(pending.map((o) => o?.expectedRevision)).toEqual([null, 1, 2]);
  expect(pending.map((o) => (o?.payload as Workout | null)?.name ?? null)).toEqual([
    'Test',
    'Edited',
    null,
  ]);
  expect(pending.map((o) => o?.kind)).toEqual(['putTemplate', 'putTemplate', 'deleteTemplate']);
  repo.close();
});
it('restores imported documents from real feed shape into imported history, not native records', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  const engine = new SyncEngine(
    repo,
    async () =>
      new Response(
        JSON.stringify({
          changes: [
            {
              entityId: workout.id,
              kind: 'putImportedWorkout',
              revision: 1,
              changeSeq: 1,
              payload: workout,
            },
          ],
          nextCursor: 1,
          hasMore: false,
        }),
      ),
  );
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect((await repo.readState()).dataset?.workouts).toEqual([workout]);
  expect((await repo.readState()).finished).toEqual([]);
  repo.close();
});
it('bootstraps legacy finished imported and template records once without uploading the draft', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  await repo.db.workouts.put(workout);
  await repo.db.templates.put({...workout, id: 'template'});
  await repo.commitDraft({...workout, id: 'draft'});
  await repo.db.importSources.put({
    key: 'legacy-v1',
    value: {
      dataset: {
        sourceLabel: 'Strong CSV',
        workouts: [{...workout, id: 'legacy-import'}],
        warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
      },
    },
  });
  await repo.bootstrapSync();
  await repo.bootstrapSync();
  expect((await repo.db.outbox.toArray()).map((o) => o.kind).sort()).toEqual([
    'putImportedWorkout',
    'putTemplate',
    'putWorkout',
  ]);
  expect((await repo.readState()).dataset?.workouts[0].id).toBe('legacy-import');
  repo.close();
});
it('stops dependent template edits after first conflict so projected revisions cannot overwrite a peer', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  let state = await repo.readState();
  await repo.db.templates.put(workout);
  await repo.db.syncState.put({key: 'revision:' + workout.id, value: 1});
  state = {...state, templates: [workout]};
  const first = {...state, templates: [{...workout, name: 'Offline edit 1'}]};
  await repo.commitState(first, state);
  await repo.commitState({...first, templates: [{...workout, name: 'Offline edit 2'}]}, first);
  const sent: unknown[][] = [];
  const engine = new SyncEngine(repo, async (url, options) => {
    if (String(url).includes('/operations')) {
      const {operations} = JSON.parse(options!.body as string);
      sent.push(operations);
      return new Response(
        JSON.stringify({
          results: operations.map((o: any) => ({
            operationId: o.operationId,
            entityId: o.entityId,
            status: 'conflict',
            revision: 2,
            changeSeq: null,
            errorCode: 'REVISION_CONFLICT',
          })),
        }),
      );
    }
    return new Response(JSON.stringify({changes: [], nextCursor: 0, hasMore: false}));
  });
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(sent.map((batch) => batch.length)).toEqual([1]);
  expect(await repo.db.outbox.count()).toBe(2);
  repo.close();
});
it('refuses a session for a different owner before accessing the API or local queue', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  await repo.db.meta.put({key: 'ownerId', value: 'different-owner'});
  let called = false;
  const engine = new SyncEngine(repo, async () => {
    called = true;
    return new Response();
  });
  await expect(engine.sync({ownerId: 'owner', csrfToken: 'test'})).rejects.toThrow();
  expect(called).toBe(false);
  repo.close();
});
it('a generic draft transition cannot hide a peer template received after the UI snapshot', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  let previous = await repo.readState();
  previous = {...previous, templates: null};
  await repo.db.templates.put(workout);
  await repo.db.meta.put({key: 'templates-null', value: false});
  await repo.commitState({...previous, active: workout}, previous);
  expect((await repo.readState()).templates).toEqual([workout]);
  expect(await repo.db.outbox.count()).toBe(0);
  repo.close();
});
it('bounds encoded operation batches below the real API ten MiB body limit', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  for (const id of ['large-a', 'large-b']) {
    const w = {
      ...workout,
      id,
      exercises: [
        {
          ...workout.exercises[0],
          sets: [{...workout.exercises[0].sets[0], original: {Notes: 'x'.repeat(6 * 1024 * 1024)}}],
        },
      ],
    };
    await repo.commitDraft(w);
    await repo.finishWorkout(w);
  }
  const batches: number[] = [];
  let seq = 0;
  const engine = new SyncEngine(repo, async (url, options) => {
    if (String(url).includes('/operations')) {
      const {operations} = JSON.parse(options!.body as string);
      batches.push(operations.length);
      return new Response(
        JSON.stringify({
          results: operations.map((o: any) => ({
            operationId: o.operationId,
            entityId: o.entityId,
            status: 'accepted',
            revision: 1,
            changeSeq: ++seq,
          })),
        }),
      );
    }
    return new Response(JSON.stringify({changes: [], nextCursor: 0, hasMore: false}));
  });
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(batches).toEqual([1, 1]);
  expect(await repo.db.outbox.count()).toBe(0);
  repo.close();
});
it('quarantines an oversized single document visibly without dropping it or blocking unrelated sync', async () => {
  const repo = new WorkoutRepository('sync-' + crypto.randomUUID());
  const w = {
    ...workout,
    exercises: [
      {
        ...workout.exercises[0],
        sets: [{...workout.exercises[0].sets[0], original: {Notes: 'x'.repeat(10 * 1024 * 1024)}}],
      },
    ],
  };
  await repo.commitDraft(w);
  await repo.finishWorkout(w);
  const engine = new SyncEngine(
    repo,
    async () => new Response(JSON.stringify({changes: [], nextCursor: 0, hasMore: false})),
  );
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(await repo.db.outbox.count()).toBe(1);
  expect(
    (await repo.db.syncState.toArray()).find((r) => r.key.startsWith('issue:'))?.value,
  ).toMatchObject({entityId: w.id, errorCode: 'DOCUMENT_TOO_LARGE'});
  repo.close();
});
