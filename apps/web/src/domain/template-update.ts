import type {ExerciseLog, Workout} from './types';

export interface TemplateUpdate {
  /** The template as it would be saved: the finished workout's exercises and values. */
  template: Workout;
  /** Template exercises the update drops, once per missing occurrence. */
  removed: string[];
}

/** An exercise's identity: the same name with another type is another exercise. */
const key = (ex: ExerciseLog) => `${ex.type}\u0000${ex.name}`;
const shape = (workout: Workout) =>
  workout.exercises.map((ex) => `${key(ex)}\u0000${ex.sets.length}`);

/**
 * The update a finished workout offers its template, or null when it kept the template's
 * exercises, their order and their set counts. Weights and reps alone never offer one.
 */
export function templateUpdate(template: Workout, finished: Workout): TemplateUpdate | null {
  const before = shape(template);
  const after = shape(finished);
  if (before.length === after.length && before.every((line, i) => line === after[i])) return null;
  const left = finished.exercises.map(key);
  const removed: string[] = [];
  for (const ex of template.exercises) {
    const at = left.indexOf(key(ex));
    if (at === -1) removed.push(ex.name);
    else left.splice(at, 1);
  }
  return {
    template: {
      ...template,
      exercises: finished.exercises.map((ex) => ({
        name: ex.name,
        type: ex.type,
        sets: ex.sets.map(({weight, reps, seconds, distance}) => ({
          id: crypto.randomUUID(),
          weight,
          reps,
          seconds,
          distance,
          completed: false,
        })),
      })),
    },
    removed,
  };
}
