import {getHistory, getRecords, setVolume} from './model';
import type {Dataset, ExerciseLog, SetRecord, Workout} from './types';

export type RecordKind = 'weight' | 'e1rm' | 'volume' | 'reps';

/** A personal record a finished workout set: its value and the best it beat. */
export interface PersonalRecord {
  exercise: string;
  kind: RecordKind;
  value: number;
  previous: number;
}

/** Display order: actual performance first, the estimate last. */
export const recordKinds: readonly RecordKind[] = ['weight', 'reps', 'volume', 'e1rm'];

const value = (records: ReturnType<typeof getRecords>, kind: RecordKind) =>
  kind === 'weight'
    ? records.heaviest?.value
    : kind === 'e1rm'
      ? records.estimated?.value
      : kind === 'volume'
        ? records.sessionVolume?.value
        : records.mostReps?.value;

/**
 * The records `workout` sets against every other workout in `history`, using the Records tab's
 * definitions (`getRecords`): heaviest weight, estimated 1RM (Epley, 1–10 reps) and session
 * volume for weighted work, most reps for bodyweight work. Assisted, duration and cardio work set
 * none, nor does an exercise's first recorded session or a kind with no earlier value to beat.
 */
export function newRecords(workout: Workout, history: Dataset): PersonalRecord[] {
  const earlier = {...history, workouts: history.workouts.filter((w) => w.id !== workout.id)};
  const now = {...history, workouts: [workout]};
  const found: PersonalRecord[] = [];
  for (const name of new Set(workout.exercises.map((exercise) => exercise.name))) {
    if (!getHistory(earlier, name).length) continue;
    const types = new Set(workout.exercises.filter((x) => x.name === name).map((x) => x.type));
    const kinds = recordKinds.filter((kind) =>
      kind === 'reps' ? types.has('bodyweight') : types.has('weighted'),
    );
    const before = getRecords(earlier, name);
    const after = getRecords(now, name);
    for (const kind of kinds) {
      const previous = value(before, kind);
      const current = value(after, kind);
      if (previous !== undefined && current !== undefined && current > previous + 1e-9)
        found.push({exercise: name, kind, value: current, previous});
    }
  }
  return found;
}

/**
 * The records a past workout set when it happened: `newRecords` against only the workouts before
 * it, so a record later beaten still shows on the day it was set.
 */
export const recordsAt = (workout: Workout, history: Dataset) =>
  newRecords(workout, {
    ...history,
    workouts: history.workouts.filter((other) => other.date < workout.date),
  });

/** Record names; non-breaking, so a wrapped list never strands "1RM (Epley)" on its own line. */
export const recordKindLabel: Record<RecordKind, string> = {
  weight: 'Heaviest\u00a0weight',
  reps: 'Most\u00a0reps',
  volume: 'Session\u00a0volume',
  e1rm: 'Est.\u00a01RM\u00a0(Epley)',
};

/** Recorded load × reps over a workout's weighted sets, as in the Records tab. */
export const workoutVolume = (workout: Workout) =>
  workout.exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.reduce((sum, set) => sum + (setVolume(set, exercise.type) ?? 0), 0),
    0,
  );

/**
 * The session's top set, an actual set and no formula: the heaviest weight with the most reps at
 * it (the least assistance for assisted work), the most reps for bodyweight work, the longest
 * hold, or the farthest cardio distance.
 */
export function topSet(exercise: ExerciseLog): SetRecord | null {
  const by = (score: (set: SetRecord) => [number, number]) =>
    exercise.sets.reduce<SetRecord | null>((best, set) => {
      if (!best) return set;
      const [a1, a2] = score(set),
        [b1, b2] = score(best);
      return a1 > b1 || (a1 === b1 && a2 > b2) ? set : best;
    }, null);
  const n = (v: number | null) => v ?? 0;
  switch (exercise.type) {
    case 'weighted':
      return by((set) => [n(set.weight), n(set.reps)]);
    case 'assisted':
      return by((set) => [-n(set.weight), n(set.reps)]);
    case 'bodyweight':
      return by((set) => [n(set.reps), 0]);
    case 'duration':
      return by((set) => [n(set.seconds), 0]);
    case 'cardio':
      return by((set) => [n(set.distance), -n(set.seconds)]);
  }
}
