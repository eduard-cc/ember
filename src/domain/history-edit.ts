import {validSet} from '../views/WorkoutView';
import type {SetRecord, Workout} from './types';

const values = ['weight', 'reps', 'seconds', 'distance'] as const;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** The editor's working copy: no completion state, so rows don't toggle or turn green. */
export function editableCopy(workout: Workout): Workout {
  return {
    ...structuredClone(workout),
    exercises: workout.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map(({completed: _completed, ...set}) => structuredClone(set)),
    })),
  };
}

export interface HistoryEdit {
  workout: Workout;
  /** New or changed sets that are not complete, valid values. */
  invalidSets: number;
  problem: string | null;
}

/**
 * Turn an edited copy back into a history document. Untouched sets keep every stored field,
 * so imported raw values survive even when they would not pass today's validation. New and
 * changed sets must be valid. A changed set keeps its source evidence. New sets carry no
 * copied provenance.
 * Exercises left without sets are dropped.
 */
export function editedHistory(base: Workout, draft: Workout): HistoryEdit {
  const previous = new Map(
    base.exercises.flatMap((ex) => ex.sets.map((set) => [set.id, {set, type: ex.type}] as const)),
  );
  let invalidSets = 0;
  const exercises = draft.exercises
    .map((ex) => ({
      ...ex,
      sets: ex.sets.map((set): SetRecord => {
        const old = previous.get(set.id);
        const changed =
          !old || old.type !== ex.type || values.some((key) => old.set[key] !== set[key]);
        if (changed && !validSet(set, ex.type)) invalidSets++;
        if (!old)
          return {
            id: set.id,
            weight: set.weight,
            reps: set.reps,
            seconds: set.seconds,
            distance: set.distance,
            completed: true,
          };
        const kept: SetRecord = {...set};
        if (old.set.completed === undefined) delete kept.completed;
        else kept.completed = old.set.completed;
        return kept;
      }),
    }))
    .filter((ex) => ex.sets.length);
  const workout = {...draft, name: draft.name.trim(), exercises};
  const problem = !workout.name
    ? 'Give the workout a name.'
    : !LOCAL_TIME.test(workout.date) || !Number.isFinite(Date.parse(workout.date + 'Z'))
      ? 'Choose a date and start time.'
      : !Number.isFinite(workout.duration) || workout.duration < 0
        ? 'Enter the duration in minutes.'
        : !exercises.length
          ? 'A workout needs at least one set. Delete the workout instead.'
          : invalidSets
            ? `Fill in ${invalidSets === 1 ? 'the new or changed set' : `all ${invalidSets} new or changed sets`}, or remove ${invalidSets === 1 ? 'it' : 'them'}.`
            : null;
  return {workout, invalidSets, problem};
}
