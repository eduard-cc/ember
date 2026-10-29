import {DatasetSchema} from '../../shared/contracts';
import {parseStrongCsv} from '../domain/model';
import type {Dataset, Workout} from '../domain/types';
import {canonical} from './canonical';
import type {WorkoutRepository} from './repository';

export interface PreparedImport {
  hash: string;
  raw: string;
  dataset: Dataset;
}
export interface ImportResult {
  status: 'imported' | 'identical';
}
export async function prepareStrongImport(bytes: Uint8Array): Promise<PreparedImport> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const raw = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  const dataset = parseStrongCsv(raw);
  dataset.workouts = dataset.workouts.map((w, i) => ({
    ...w,
    id: `import:${hash}:${i}`,
    exercises: w.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({...s, id: `import:${hash}:${s.id}`})),
    })),
  }));
  return {hash, raw, dataset: DatasetSchema.parse(dataset)};
}
export async function commitStrongImport(
  repository: WorkoutRepository,
  prepared: PreparedImport,
  confirmed: boolean,
): Promise<ImportResult> {
  const dataset = DatasetSchema.parse(prepared.dataset);
  if (!/^[a-f0-9]{64}$/.test(prepared.hash)) throw new Error('Invalid import hash');
  if (!confirmed) throw new Error('Review and confirm replacing imported history');
  await repository.flush();
  const db = repository.db;
  return db.transaction('rw', [db.meta, db.importSources, db.outbox, db.syncState], async () => {
    const old = (await db.importSources.toArray()).filter((r) => r.key.startsWith('imported:'));
    if (
      old.length === dataset.workouts.length &&
      dataset.workouts.every((workout) => {
        const existing = old.find((r) => r.key === 'imported:' + workout.id);
        return existing && canonical(existing.value) === canonical(workout);
      })
    ) {
      await db.importSources.put({
        key: 'hash:' + prepared.hash,
        value: {
          hash: prepared.hash,
          raw: prepared.raw,
          workoutIds: dataset.workouts.map((w) => w.id),
        },
      });
      return {status: 'identical'};
    }
    for (const record of old) {
      const workout = record.value as Workout;
      const incoming = dataset.workouts.find((w) => w.id === workout.id);
      if (incoming && canonical(incoming) === canonical(workout)) continue;
      await repository.queueOperation('deleteImportedWorkout', workout.id, null);
      await db.importSources.delete(record.key);
    }
    for (const workout of dataset.workouts) {
      const existing = old.find((r) => r.key === 'imported:' + workout.id);
      if (existing && canonical(existing.value) === canonical(workout)) continue;
      await db.importSources.put({key: 'imported:' + workout.id, value: workout});
      await repository.queueOperation('putImportedWorkout', workout.id, workout);
    }
    await db.importSources.put({
      key: 'hash:' + prepared.hash,
      value: {
        hash: prepared.hash,
        raw: prepared.raw,
        workoutIds: dataset.workouts.map((w) => w.id),
      },
    });
    await db.importSources.put({key: 'current-dataset', value: {dataset}});
    await db.meta.put({key: 'imported-sync-active', value: true});
    return {status: 'imported'};
  });
}
