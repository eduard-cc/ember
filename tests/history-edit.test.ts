import 'fake-indexeddb/auto';

import {expect, it} from 'vitest';

import {LocalOperationSchema} from '../shared/contracts';
import {editableCopy, editedHistory} from '../src/domain/history-edit';
import type {Workout} from '../src/domain/types';
import {exportBackup} from '../src/storage/backup';
import {commitStrongImport, prepareStrongImport} from '../src/storage/import';
import {WorkoutRepository} from '../src/storage/repository';
import {DELETES_CURSOR, SyncEngine} from '../src/sync/engine';

// Synthetic values only.
const native: Workout = {
  id: 'native',
  name: 'Logged here',
  date: '2026-03-01T10:00:00',
  duration: 30,
  exercises: [
    {
      name: 'Press',
      type: 'weighted',
      sets: [
        {id: 'n1', weight: 40, reps: 8, seconds: null, distance: null, completed: true},
        {id: 'n2', weight: 40, reps: 7, seconds: null, distance: null, completed: true},
      ],
    },
  ],
};
const csv =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration\n' +
  '2026-01-01 10:00:00;Upper;Press;1;40;kg;8;;30m\n' +
  '2026-01-01 10:00:00;Upper;Press;2;40;kg;80;;30m\n' +
  '2026-01-08 10:00:00;Upper;Press;1;42;kg;8;;30m';
const repo = () =>
  new WorkoutRepository('history-edit-' + crypto.randomUUID(), () =>
    new Date('2026-03-01T10:30:00').getTime(),
  );
const finish = async (repository: WorkoutRepository) => {
  await repository.commitDraft(native);
  return repository.finishWorkout(native);
};
const operations = async (repository: WorkoutRepository) => {
  const order = (await repository.db.syncState.get('queue-order'))?.value as string[];
  const all = await repository.db.outbox.toArray();
  return order.map((id) => all.find((o) => o.operationId === id)!).filter(Boolean);
};

it('edits keep untouched imported evidence and clear the review flag only on corrected sets', () => {
  const base: Workout = {
    ...native,
    exercises: [
      {
        ...native.exercises[0],
        sets: [
          {...native.exercises[0].sets[0], completed: undefined, original: {Reps: '8'}},
          {
            id: 'odd',
            weight: 40,
            reps: 80,
            seconds: null,
            distance: null,
            suspicious: true,
            excluded: true,
            original: {Reps: '80'},
          },
          {id: 'raw', weight: null, reps: 0, seconds: null, distance: null, original: {Reps: '0'}},
        ],
      },
    ],
  };
  const draft = editableCopy(base);
  expect(draft.exercises[0].sets.every((s) => !('completed' in s))).toBe(true);
  draft.exercises[0].sets[1] = {...draft.exercises[0].sets[1], reps: 8, completed: false};
  draft.name = '  Upper (fixed)  ';
  const {workout, problem} = editedHistory(base, draft);
  expect(problem).toBeNull();
  expect(workout.name).toBe('Upper (fixed)');
  const [kept, corrected, raw] = workout.exercises[0].sets;
  // Untouched: byte-for-byte, including an absent completion flag.
  expect(kept).toEqual(base.exercises[0].sets[0]);
  expect('completed' in kept).toBe(false);
  // Untouched invalid raw value is allowed to stay as imported.
  expect(raw).toEqual(base.exercises[0].sets[2]);
  // Corrected: new value, same evidence and exclusion, no review flag, no draft state.
  expect(corrected).toEqual({
    id: 'odd',
    weight: 40,
    reps: 8,
    seconds: null,
    distance: null,
    excluded: true,
    original: {Reps: '80'},
  });
});

it('new and changed sets must be valid; empty exercises are dropped; empty workouts refused', () => {
  const draft = editableCopy(native);
  draft.exercises[0].sets.push({id: 'new', weight: 50, reps: null, seconds: null, distance: null});
  expect(editedHistory(native, draft).problem).toMatch(/Fill in the new or changed set/);
  draft.exercises[0].sets[2].reps = 5;
  const added = editedHistory(native, draft);
  expect(added.problem).toBeNull();
  expect(added.workout.exercises[0].sets[2]).toEqual({
    id: 'new',
    weight: 50,
    reps: 5,
    seconds: null,
    distance: null,
    completed: true,
  });
  const emptied = editableCopy(native);
  emptied.exercises.push({name: 'Row', type: 'weighted', sets: []});
  expect(editedHistory(native, emptied).workout.exercises.map((e) => e.name)).toEqual(['Press']);
  emptied.exercises[0].sets = [];
  expect(editedHistory(native, emptied).problem).toMatch(/Delete the workout instead/);
  expect(editedHistory(native, {...editableCopy(native), name: ' '}).problem).toMatch(/name/);
  expect(editedHistory(native, {...editableCopy(native), date: ''}).problem).toMatch(/date/);
  expect(editedHistory(native, {...editableCopy(native), duration: NaN}).problem).toMatch(
    /duration/,
  );
});

it('edits a finished workout in place and queues a revisioned putWorkout', async () => {
  const repository = repo();
  const finished = await finish(repository);
  await repository.db.outbox.clear();
  await repository.db.syncState.put({key: 'queue-order', value: []});
  await repository.db.syncState.put({key: 'revision:native', value: 2});
  const next = {...finished, name: 'Renamed', duration: 45};
  await repository.changeHistoryWorkout(finished, next);
  expect(await repository.db.workouts.get('native')).toEqual(next);
  const [op] = await operations(repository);
  expect([op.kind, op.expectedRevision, op.payload]).toEqual(['putWorkout', 2, next]);
  expect(LocalOperationSchema.safeParse(op).success).toBe(true);
  // A stale editor base is refused without writing anything.
  await expect(
    repository.changeHistoryWorkout(finished, {...finished, name: 'Stale'}),
  ).rejects.toThrow(/changed since displayed/);
  expect((await repository.db.workouts.get('native'))?.name).toBe('Renamed');
  expect(await repository.db.outbox.count()).toBe(1);
  repository.close();
});

it('deletes a synced finished workout with a tombstone and removes it from the order', async () => {
  const repository = repo();
  const finished = await finish(repository);
  await repository.db.outbox.clear();
  await repository.db.syncState.put({key: 'queue-order', value: []});
  await repository.db.syncState.put({key: 'revision:native', value: 1});
  await repository.changeHistoryWorkout(finished, null);
  expect(await repository.db.workouts.get('native')).toBeUndefined();
  expect((await repository.readState()).finished).toEqual([]);
  expect((await repository.db.meta.get('finished-order'))?.value).toEqual([]);
  const [op] = await operations(repository);
  expect([op.kind, op.expectedRevision, op.payload]).toEqual(['deleteWorkout', 1, null]);
  expect(LocalOperationSchema.safeParse(op).success).toBe(true);
  // An offline deletion must not prevent exporting a validated recovery archive.
  const backup = JSON.parse(await exportBackup(repository));
  expect(backup.state.finished).toEqual([]);
  expect(backup.pendingOperations.operations).toEqual([op]);
  repository.close();
});

it('a pending create is followed by its tombstone; a never-queued local record just goes', async () => {
  const repository = repo();
  const finished = await finish(repository);
  await repository.changeHistoryWorkout(finished, null);
  expect(
    (await operations(repository)).map((o) => [o.kind, o.expectedRevision, o.payload?.id]),
  ).toEqual([
    ['putWorkout', null, 'native'],
    ['deleteWorkout', 1, undefined],
  ]);
  const local = repo();
  await local.db.workouts.add(native);
  await local.changeHistoryWorkout(native, null);
  expect(await local.db.outbox.count()).toBe(0);
  expect(await local.db.workouts.count()).toBe(0);
  repository.close();
  local.close();
});

it('edits and deletes synchronized imported history with imported operation kinds', async () => {
  const repository = repo();
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  await commitStrongImport(repository, prepared, true);
  await repository.db.outbox.clear();
  await repository.db.syncState.put({key: 'queue-order', value: []});
  const [later, earlier] = (await repository.readState()).dataset!.workouts;
  for (const w of [later, earlier])
    await repository.db.syncState.put({key: 'revision:' + w.id, value: 1});
  const draft = editableCopy(earlier);
  draft.exercises[0].sets[1].reps = 8;
  const {workout: edited} = editedHistory(earlier, draft);
  await repository.changeHistoryWorkout(earlier, edited);
  await repository.changeHistoryWorkout(later, null);
  const state = await repository.readState();
  expect(state.dataset!.workouts).toEqual([edited]);
  expect(edited.exercises[0].sets[1].original).toEqual(earlier.exercises[0].sets[1].original);
  expect((await operations(repository)).map((o) => [o.kind, o.entityId])).toEqual([
    ['putImportedWorkout', earlier.id],
    ['deleteImportedWorkout', later.id],
  ]);
  // Raw import evidence is never touched.
  const source = await repository.db.importSources.get('hash:' + prepared.hash);
  expect((source?.value as {raw: string}).raw).toBe(csv);
  repository.close();
});

it.each(['edit', 'delete'] as const)(
  '%s works after a Strong reimport carries a set exclusion',
  async (action) => {
    const repository = repo();
    try {
      await commitStrongImport(
        repository,
        await prepareStrongImport(new TextEncoder().encode(csv)),
        true,
      );
      const earlier = (await repository.readState()).dataset!.workouts[1];
      await repository.setSetExcluded(earlier.id, earlier.exercises[0].sets[1].id, true);
      const newerCsv = csv + '\n2026-01-15 10:00:00;Upper;Press;1;44;kg;8;;30m';
      await commitStrongImport(
        repository,
        await prepareStrongImport(new TextEncoder().encode(newerCsv)),
        true,
      );
      const base = (await repository.readState()).dataset!.workouts.find(
        (w) => w.date === earlier.date,
      )!;
      expect(base.exercises[0].sets[1].excluded).toBe(true);
      // readState normalizes schema key order; the carried flag was appended in storage.
      const next = action === 'edit' ? {...base, name: 'Corrected import'} : null;
      await repository.changeHistoryWorkout(base, next);
      const stored = (await repository.readState()).dataset!.workouts.find((w) => w.id === base.id);
      if (next) expect(stored).toEqual(next);
      else expect(stored).toBeUndefined();
    } finally {
      repository.close();
    }
  },
);

it('edits and deletes a never-synchronized import in the local dataset copy only', async () => {
  const repository = repo();
  const dataset = (await prepareStrongImport(new TextEncoder().encode(csv))).dataset;
  await repository.commitState({version: 1, dataset, active: null, finished: [], templates: []});
  const [later, earlier] = dataset.workouts;
  await repository.changeHistoryWorkout(later, null);
  await repository.changeHistoryWorkout(earlier, {...earlier, name: 'Renamed import'});
  expect((await repository.readState()).dataset!.workouts.map((w) => w.name)).toEqual([
    'Renamed import',
  ]);
  expect(await repository.db.outbox.count()).toBe(0);
  repository.close();
});

it('applies a peer deletion from the opt-in feed and replays from zero once', async () => {
  const repository = repo();
  await repository.db.workouts.add(native);
  await repository.db.syncState.put({key: 'revision:native', value: 1});
  // A legacy cursor past the tombstone must not hide it from the upgraded app.
  await repository.db.syncState.put({key: 'cursor', value: 7});
  const requests: {url: string; headers: Headers}[] = [];
  const engine = new SyncEngine(repository, async (url, init) => {
    requests.push({url: String(url), headers: new Headers(init?.headers)});
    return new Response(
      JSON.stringify({
        changes:
          requests.length === 1
            ? [
                {
                  entityId: 'native',
                  kind: 'deleteWorkout',
                  revision: 2,
                  changeSeq: 5,
                  payload: null,
                },
              ]
            : [
                {
                  entityId: 'other',
                  kind: 'deleteWorkout',
                  revision: 2,
                  changeSeq: 6,
                  payload: null,
                },
                {
                  entityId: 'latest',
                  kind: 'putWorkout',
                  revision: 1,
                  changeSeq: 8,
                  payload: {...native, id: 'latest'},
                },
              ],
        nextCursor: requests.length === 1 ? 5 : 8,
        hasMore: false,
      }),
    );
  });
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(requests[0].url).toContain('after=0&');
  expect(requests[0].headers.get('X-Sync-Workout-Deletes')).toBe('1');
  expect(requests[0].headers.get('X-Sync-Body-Weight')).toBe('1');
  expect(await repository.db.workouts.get('native')).toBeUndefined();
  expect((await repository.db.syncState.get(DELETES_CURSOR))?.value).toBe(5);
  expect((await repository.db.syncState.get('cursor'))?.value).toBe(5);
  // Roll back to the body-weight app: its cursors can pass a tombstone it cannot read.
  await repository.db.workouts.put({...native, id: 'other'});
  await repository.db.syncState.put({key: 'revision:other', value: 1});
  await repository.db.syncState.put({key: 'cursor', value: 8});
  await repository.db.syncState.put({key: 'body-weight-cursor', value: 8});
  // Re-upgrade resumes the independent cursor, not either legacy cursor, and catches it.
  await engine.sync({ownerId: 'owner', csrfToken: 'test'});
  expect(requests[1].url).toContain('after=5&');
  expect(await repository.db.workouts.get('other')).toBeUndefined();
  expect(await repository.db.workouts.get('latest')).toEqual({...native, id: 'latest'});
  expect((await repository.db.syncState.get(DELETES_CURSOR))?.value).toBe(8);
  repository.close();
});
