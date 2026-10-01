import 'fake-indexeddb/auto';

import {expect, it} from 'vitest';

import {commitStrongImport, prepareStrongImport} from '../src/storage/import';
import {WorkoutRepository} from '../src/storage/repository';

export const csv =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Seconds;Workout Duration;Notes\n2026-01-01 10:00:00;Collision;Press;1;;kg;0;;30m;raw\n2026-01-01 10:00:00;Collision;Pull;1;0;kg;8;;30m;raw\n2026-01-01 10:00:00;Collision;Press;1;20;kg;8;;30m;raw\n2026-01-01 11:00:00;Collision;Press;1;20;kg;8;;30m;raw';
it('identical exact-byte Strong import is durably a no-op', async () => {
  const repo = new WorkoutRepository('import-' + crypto.randomUUID());
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  await commitStrongImport(repo, prepared, true);
  const operations = await repo.db.outbox.toArray();
  expect(await commitStrongImport(repo, prepared, true)).toBe('identical');
  expect(await repo.db.outbox.toArray()).toEqual(operations);
  expect((await repo.readState()).dataset?.workouts).toEqual(prepared.dataset.workouts);
  repo.close();
});
it('historical file hash does not prevent A to B to A replacement', async () => {
  const repo = new WorkoutRepository('import-' + crypto.randomUUID());
  const a = await prepareStrongImport(new TextEncoder().encode(csv));
  const b = await prepareStrongImport(
    new TextEncoder().encode(csv.replaceAll('Collision', 'Replacement')),
  );
  await commitStrongImport(repo, a, true);
  await commitStrongImport(repo, b, true);
  expect(await commitStrongImport(repo, a, true)).toBe('imported');
  expect((await repo.readState()).dataset?.workouts).toEqual(a.dataset.workouts);
  repo.close();
});
it('keeps repeated exercise occurrences and blank/zero originals rather than merging by name', async () => {
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  expect(prepared.dataset.workouts).toHaveLength(2);
  const session = prepared.dataset.workouts.find((w) => w.date === '2026-01-01T10:00:00')!;
  expect(session.exercises.map((e) => e.name)).toEqual(['Press', 'Pull', 'Press']);
  expect(session.exercises[0].sets[0]).toMatchObject({
    weight: null,
    reps: 0,
    original: {Weight: '', Reps: '0'},
  });
});
it('subset import removes extra peer records but retains identical overlapping records without requeueing', async () => {
  const repo = new WorkoutRepository('import-' + crypto.randomUUID());
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  const extra = {...prepared.dataset.workouts[0], id: 'peer-extra'};
  for (const workout of [...prepared.dataset.workouts, extra]) {
    await repo.db.importSources.put({key: 'imported:' + workout.id, value: workout});
    await repo.db.syncState.put({key: 'revision:' + workout.id, value: 1});
  }
  expect(await commitStrongImport(repo, prepared, true)).toBe('imported');
  expect((await repo.readState()).dataset?.workouts).toEqual(prepared.dataset.workouts);
  expect(await repo.db.outbox.toArray()).toEqual([
    expect.objectContaining({
      entityId: extra.id,
      kind: 'deleteImportedWorkout',
      expectedRevision: 1,
    }),
  ]);
  repo.close();
});
it('identical-file import is a no-op on a fresh peer that already pulled that exact file history', async () => {
  const repo = new WorkoutRepository('import-' + crypto.randomUUID());
  const prepared = await prepareStrongImport(new TextEncoder().encode(csv));
  for (const workout of prepared.dataset.workouts)
    await repo.db.importSources.put({key: 'imported:' + workout.id, value: workout});
  await repo.db.meta.put({key: 'imported-sync-active', value: true});
  expect(await commitStrongImport(repo, prepared, true)).toBe('identical');
  expect(await repo.db.outbox.count()).toBe(0);
  repo.close();
});
