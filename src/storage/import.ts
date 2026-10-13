import {DatasetSchema} from '../../shared/contracts';
import {parseStrongCsv} from '../domain/model';
import type {Dataset, Workout} from '../domain/types';
import type {AppState} from '../state/workout';
import type {WorkoutRepository} from './repository';

export interface PreparedImport {
  hash: string;
  raw: string;
  dataset: Dataset;
}
export interface ImportResult {
  status: 'imported' | 'identical';
  /** Owner exclusions whose raw source row is no longer in the new export. */
  unmatchedExclusions: number;
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
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
      .join(',') +
    '}'
  );
};
/**
 * Carry owner exclusions to the same raw source row in a new export. A row is identified by
 * its complete original cells; identical repeated rows match by occurrence order. Raw values
 * are never changed, and exclusions whose row vanished are counted rather than guessed.
 */
function carryExclusions(previous: Workout[], incoming: Workout[]) {
  const incomingIds = new Set(
    incoming.flatMap((w) => w.exercises.flatMap((e) => e.sets.map((s) => s.id))),
  );
  // The same file yields the same set ids, so those match exactly (even repeated rows).
  const byId = new Set<string>();
  const excluded = new Map<string, number>();
  let unmatched = 0;
  for (const workout of previous)
    for (const exercise of workout.exercises)
      for (const set of exercise.sets)
        if (set.excluded) {
          if (incomingIds.has(set.id)) byId.add(set.id);
          else if (!set.original) unmatched++;
          else {
            const key = canonical(set.original);
            excluded.set(key, (excluded.get(key) ?? 0) + 1);
          }
        }
  if (!byId.size && !excluded.size) return {workouts: incoming, unmatched};
  const workouts = incoming.map((workout) => ({
    ...workout,
    exercises: workout.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => {
        if (byId.has(set.id)) return {...set, excluded: true};
        const key = set.original && canonical(set.original);
        const remaining = key ? (excluded.get(key) ?? 0) : 0;
        if (!key || !remaining) return set;
        excluded.set(key, remaining - 1);
        return {...set, excluded: true};
      }),
    })),
  }));
  for (const count of excluded.values()) unmatched += count;
  return {workouts, unmatched};
}
export async function commitStrongImport(
  repository: WorkoutRepository,
  prepared: PreparedImport,
  confirmed: boolean,
): Promise<ImportResult> {
  const parsed = DatasetSchema.parse(prepared.dataset);
  if (!/^[a-f0-9]{64}$/.test(prepared.hash)) throw new Error('Invalid import hash');
  if (!confirmed) throw new Error('Review and confirm replacing imported history');
  await repository.flush();
  const db = repository.db;
  return db.transaction('rw', [db.meta, db.importSources, db.outbox, db.syncState], async () => {
    const old = (await db.importSources.toArray()).filter((r) => r.key.startsWith('imported:'));
    const syncActive = (await db.meta.get('imported-sync-active'))?.value === true;
    const local =
      (await db.importSources.get('current-dataset')) ?? (await db.importSources.get('legacy-v1'));
    const previous = syncActive
      ? old.map((r) => r.value as Workout)
      : ((local?.value as {dataset?: AppState['dataset']} | undefined)?.dataset?.workouts ?? []);
    const carried = carryExclusions(previous, parsed.workouts);
    const dataset = {...parsed, workouts: carried.workouts};
    const unmatchedExclusions = carried.unmatched;
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
      return {status: 'identical', unmatchedExclusions};
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
    return {status: 'imported', unmatchedExclusions};
  });
}
