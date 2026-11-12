import type {Workout} from './types';

/** Whole seconds since a local workout timestamp; 0 when it is unparseable or in the future. */
export function elapsedSeconds(start: string, now: number): number {
  const started = new Date(start).getTime();
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
}
/**
 * Elapsed minutes from a local workout timestamp, matching the logger's timer.
 * Whole minutes from one minute on; shorter sessions keep their whole seconds as a
 * fraction so they stay distinguishable from 0, which means unknown.
 */
export function elapsedMinutes(start: string, finishedAt: number): number {
  const seconds = elapsedSeconds(start, finishedAt);
  return seconds < 60 ? seconds / 60 : Math.floor(seconds / 60);
}

/** History label for a stored duration in minutes; 0 is unknown and shows nothing. */
export function durationLabel(minutes: number): string {
  if (!minutes) return '';
  return minutes < 1 ? '<1 min' : `${minutes} min`;
}

/**
 * A rough length for `sets` sets, from the owner's own pace: minutes per set over every workout
 * with a known duration of a minute or more, rounded to 5 minutes. Null without such history.
 */
export function estimatedMinutes(sets: number, workouts: Workout[]): number | null {
  let minutes = 0,
    count = 0;
  for (const workout of workouts) {
    const n = workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    if (workout.duration < 1 || !n) continue;
    minutes += workout.duration;
    count += n;
  }
  if (!count || !sets) return null;
  return Math.max(5, Math.round((sets * minutes) / count / 5) * 5);
}
