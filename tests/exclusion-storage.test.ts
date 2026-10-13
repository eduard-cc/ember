import 'fake-indexeddb/auto';

import {expect, it} from 'vitest';

import type {Workout} from '../src/domain/types';
import {commitStrongImport, prepareStrongImport} from '../src/storage/import';
import {WorkoutRepository} from '../src/storage/repository';

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
        {id: 'n2', weight: 40, reps: 80, seconds: null, distance: null, completed: true},
      ],
    },
  ],
};
const csv =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration\n' +
  '2026-01-01 10:00:00;Upper;Press;1;40;kg;8;;30m\n' +
  '2026-01-01 10:00:00;Upper;Press;2;40;kg;60;;30m\n' +
  '2026-01-08 10:00:00;Upper;Press;1;42;kg;8;;30m';
const repo = () => new WorkoutRepository('exclusion-' + crypto.randomUUID());
const finish = async (repository: WorkoutRepository) => {
  await repository.commitDraft(native);
  await repository.finishWorkout(native);
};
const flagged = (workouts: Workout[]) =>
  workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets)).find((s) => s.reps === 60)!;

it('excludes an app-logged set and queues a putWorkout update after the create', async () => {
  const repository = repo();
  await finish(repository);
  const updated = await repository.setSetExcluded('native', 'n2', true);
  expect(updated.exercises[0].sets[1]).toEqual({...native.exercises[0].sets[1], excluded: true});
  expect(await repository.db.workouts.get('native')).toEqual(updated);
  const operations = await repository.db.outbox.toArray();
  expect(operations.map((o) => [o.kind, o.expectedRevision])).toEqual(
    expect.arrayContaining([
      ['putWorkout', null],
      ['putWorkout', 1],
    ]),
  );
  const order = (await repository.db.syncState.get('queue-order'))?.value as string[];
  expect(operations.find((o) => o.operationId === order[1])?.payload).toEqual(updated);
  repository.close();
});

it('uses the acknowledged revision for a synced workout and includes again exactly', async () => {
  const repository = repo();
  await finish(repository);
  await repository.db.outbox.clear();
  await repository.db.syncState.put({key: 'revision:native', value: 3});
  await repository.setSetExcluded('native', 'n2', true);
  const restored = await repository.setSetExcluded('native', 'n2', false);
  expect(restored).toEqual(native);
  expect((await repository.db.outbox.toArray()).map((o) => o.expectedRevision).sort()).toEqual([
    3, 4,
  ]);
  repository.close();
});

it('excludes an imported set with putImportedWorkout and keeps raw source values', async () => {
  const repository = repo();
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  await commitStrongImport(repository, prepared, true);
  await repository.db.outbox.clear();
  const target = prepared.dataset.workouts.find((w) => w.exercises[0].sets.length === 2)!;
  const set = flagged([target]);
  await repository.setSetExcluded(target.id, set.id, true);
  const state = await repository.readState();
  expect(flagged(state.dataset!.workouts)).toEqual({...set, excluded: true});
  const [operation] = await repository.db.outbox.toArray();
  expect(operation).toMatchObject({kind: 'putImportedWorkout', entityId: target.id});
  expect(flagged([operation.payload!]).original).toEqual(set.original);
  repository.close();
});

it('excludes in an unsynchronized local dataset without queueing or touching legacy bytes', async () => {
  const repository = repo();
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  await repository.db.importSources.put({
    key: 'legacy-v1',
    value: {raw: 'original bytes', dataset: prepared.dataset},
  });
  const target = prepared.dataset.workouts.find((w) => w.exercises[0].sets.length === 2)!;
  await repository.setSetExcluded(target.id, flagged([target]).id, true);
  expect(flagged((await repository.readState()).dataset!.workouts).excluded).toBe(true);
  expect(await repository.db.outbox.count()).toBe(0);
  expect((await repository.db.importSources.get('legacy-v1'))?.value).toEqual({
    raw: 'original bytes',
    dataset: prepared.dataset,
  });
  repository.close();
});

it('a repeated identical toggle (double tap) is a no-op that queues nothing', async () => {
  const repository = repo();
  await finish(repository);
  await repository.setSetExcluded('native', 'n2', true);
  const operations = await repository.db.outbox.toArray();
  await repository.setSetExcluded('native', 'n2', true);
  expect(await repository.db.outbox.toArray()).toEqual(operations);
  repository.close();
});

it('a dataset reset does not re-create acknowledged workouts that only have a pending exclusion', async () => {
  const repository = repo();
  await finish(repository);
  await repository.db.outbox.clear();
  await repository.db.syncState.put({key: 'revision:native', value: 1});
  await repository.setSetExcluded('native', 'n2', true);
  await repository.resetToEpoch('next-epoch');
  expect(await repository.db.workouts.count()).toBe(0);
  expect(await repository.db.outbox.count()).toBe(0);
  repository.close();
});

it('refuses unknown workouts and sets without writing anything', async () => {
  const repository = repo();
  await finish(repository);
  const before = await repository.db.outbox.toArray();
  await expect(repository.setSetExcluded('missing', 'n2', true)).rejects.toThrow();
  await expect(repository.setSetExcluded('native', 'missing', true)).rejects.toThrow();
  expect(await repository.db.outbox.toArray()).toEqual(before);
  expect(await repository.db.workouts.get('native')).toEqual(native);
  repository.close();
});

it('an identical reimport keeps the exclusion and changes nothing', async () => {
  const repository = repo();
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  await commitStrongImport(repository, prepared, true);
  const target = prepared.dataset.workouts.find((w) => w.exercises[0].sets.length === 2)!;
  await repository.setSetExcluded(target.id, flagged([target]).id, true);
  const operations = await repository.db.outbox.toArray();
  const again = await prepareStrongImport(new TextEncoder().encode(csv));
  expect(await commitStrongImport(repository, again, true)).toEqual({
    status: 'identical',
    unmatchedExclusions: 0,
  });
  expect(flagged((await repository.readState()).dataset!.workouts).excluded).toBe(true);
  expect(await repository.db.outbox.toArray()).toEqual(operations);
  repository.close();
});

it('an identical reimport keeps an exclusion on the second of two identical raw rows', async () => {
  const repository = repo();
  const duplicated = csv + '\n2026-01-08 10:00:00;Upper;Press;1;42;kg;8;;30m';
  const prepared = await prepareStrongImport(new TextEncoder().encode(duplicated));
  await commitStrongImport(repository, prepared, true);
  const target = prepared.dataset.workouts.find((w) => w.date === '2026-01-08T10:00:00')!;
  const second = target.exercises[0].sets[1];
  await repository.setSetExcluded(target.id, second.id, true);
  const operations = await repository.db.outbox.toArray();
  const again = await prepareStrongImport(new TextEncoder().encode(duplicated));
  expect((await commitStrongImport(repository, again, true)).status).toBe('identical');
  const sets = (await repository.readState()).dataset!.workouts.find((w) => w.id === target.id)!
    .exercises[0].sets;
  expect(sets.map((s) => s.excluded === true)).toEqual([false, true]);
  expect(await repository.db.outbox.toArray()).toEqual(operations);
  repository.close();
});

it('an updated export carries exclusions to the same raw row and reports rows that vanished', async () => {
  const repository = repo();
  await commitStrongImport(
    repository,
    await prepareStrongImport(new TextEncoder().encode(csv)),
    true,
  );
  for (const w of (await repository.readState()).dataset!.workouts)
    for (const s of w.exercises[0].sets)
      if (s.reps === 60 || s.weight === 42) await repository.setSetExcluded(w.id, s.id, true);
  // New export: one more workout, and the 42 kg row was corrected in Strong.
  const updated = await prepareStrongImport(
    new TextEncoder().encode(
      csv.replace(';42;kg;8;', ';43;kg;8;') + '\n2026-01-15 10:00:00;Upper;Press;1;44;kg;8;;30m',
    ),
  );
  expect(await commitStrongImport(repository, updated, true)).toEqual({
    status: 'imported',
    unmatchedExclusions: 1,
  });
  const sets = (await repository.readState()).dataset!.workouts.flatMap((w) =>
    w.exercises.flatMap((e) => e.sets),
  );
  expect(sets.filter((s) => s.excluded).map((s) => s.reps)).toEqual([60]);
  expect(sets.find((s) => s.reps === 60)?.id).toMatch(new RegExp('^import:' + updated.hash));
  repository.close();
});
