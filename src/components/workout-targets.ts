import {getHistory} from '../domain/model';
import type {Dataset, ExerciseLog, ExerciseType, SetRecord, Workout} from '../domain/types';

const blank = (type: ExerciseType): SetRecord => ({
  id: crypto.randomUUID(),
  weight: null,
  reps: null,
  seconds: null,
  // Cardio keeps the pre-redesign 0 km default so time alone can be completed.
  distance: type === 'cardio' ? 0 : null,
  completed: false,
});

const target = (type: ExerciseType, source: SetRecord | undefined): SetRecord =>
  source
    ? {
        ...blank(type),
        weight: source.weight,
        reps: source.reps,
        seconds: source.seconds,
        distance: source.distance,
      }
    : blank(type);

/** UI start targets only: no edits to historical documents, provenance or storage. */
export function historyTargets(
  dataset: Dataset,
  name: string,
  type: ExerciseType,
  count?: number,
  fallback: SetRecord[] = [],
): ExerciseLog {
  const previous = getHistory(dataset, name).find(
    (session) =>
      session.type === type && session.sets.some((set) => !set.excluded && !set.suspicious),
  );
  const evidence = previous?.sets.filter((set) => !set.excluded && !set.suspicious) ?? [];
  const length = count ?? (evidence.length || (type === 'cardio' || type === 'duration' ? 1 : 3));
  return {
    name,
    type,
    sets: Array.from({length}, (_, index) =>
      // Actual history wins; otherwise the routine's own planned values are the target.
      target(type, evidence[index] ?? evidence.at(-1) ?? fallback[index]),
    ),
  };
}

export function routineTargets(workout: Workout, dataset: Dataset): Workout {
  return {
    ...workout,
    exercises: workout.exercises.map((ex) =>
      historyTargets(dataset, ex.name, ex.type, ex.sets.length, ex.sets),
    ),
  };
}
