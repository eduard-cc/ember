import type {ExerciseLog, ExerciseType, SetRecord, Workout} from './types';

/** Duration and cardio work is logged in seconds rather than reps and load. */
export const isTimed = (type: ExerciseType) => type === 'duration' || type === 'cardio';

export function validSet(set: SetRecord, type: ExerciseType) {
  const bounded = (value: number | null, min: number, max: number) =>
    value !== null && Number.isFinite(value) && value >= min && value <= max;
  if (isTimed(type))
    return bounded(set.seconds, 1, 86400) && (type !== 'cardio' || bounded(set.distance, 0, 1000));
  return (
    bounded(set.reps, 1, 1000) &&
    Number.isInteger(set.reps) &&
    (type === 'bodyweight' || bounded(set.weight, 0, 2000))
  );
}

/** Sets that count toward a finished workout: confirmed and within bounds. */
export const countedSets = (ex: ExerciseLog) =>
  ex.sets.filter((set) => set.completed && validSet(set, ex.type));

export const setCount = (workout: Workout) =>
  workout.exercises.reduce((n, ex) => n + ex.sets.length, 0);
