import {RETIRED_SET_KEYS, RETIRED_WARNING_KEYS} from '../../shared/contracts';

type Doc = Record<string, unknown>;
const isDoc = (value: unknown): value is Doc =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const drop = (value: Doc, keys: readonly string[]) => {
  let changed = false;
  for (const key of keys)
    if (key in value) {
      delete value[key];
      changed = true;
    }
  return changed;
};

/** Remove the retired set review flags from a stored workout in place; true when it changed. */
export function stripWorkout(workout: unknown): boolean {
  if (!isDoc(workout) || !Array.isArray(workout.exercises)) return false;
  let changed = false;
  for (const exercise of workout.exercises)
    if (isDoc(exercise) && Array.isArray(exercise.sets))
      for (const set of exercise.sets)
        if (isDoc(set) && drop(set, RETIRED_SET_KEYS)) changed = true;
  return changed;
}

/** The same for a stored dataset: every workout and the retired import warning count. */
function stripDataset(dataset: unknown): boolean {
  if (!isDoc(dataset)) return false;
  let changed = isDoc(dataset.warnings) && drop(dataset.warnings, RETIRED_WARNING_KEYS);
  if (Array.isArray(dataset.workouts))
    for (const workout of dataset.workouts) if (stripWorkout(workout)) changed = true;
  return changed;
}

/**
 * IndexedDB upgrade body: working copies of history, templates, drafts, queued operations and
 * imported documents lose the retired fields. Original import bytes (`raw`) and restore
 * evidence archives are kept exactly as written.
 */
export function stripImportSource(key: string, value: unknown): boolean {
  if (key.startsWith('imported:')) return stripWorkout(value);
  if (key === 'current-dataset' || key === 'legacy-v1')
    return isDoc(value) ? stripDataset(value.dataset) : false;
  return false;
}
