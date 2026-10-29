import {localDay} from '../utils/date';
import {isTimed} from './sets';
import type {
  Comparable,
  Dataset,
  ExerciseSession,
  ExerciseType,
  Metric,
  SetRecord,
  TrendPoint,
  Workout,
} from './types';

export function getExercises(dataset: Dataset): string[] {
  return [
    ...new Set(
      dataset.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.name)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
export interface ExerciseStat {
  /** Unique workouts containing the exercise; repeated blocks in one workout count once. */
  sessions: number;
  last: string;
}
export function exerciseStats(dataset: Dataset): Map<string, ExerciseStat> {
  const stats = new Map<string, ExerciseStat>();
  for (const workout of dataset.workouts)
    for (const name of new Set(workout.exercises.map((exercise) => exercise.name))) {
      const current = stats.get(name);
      if (!current) stats.set(name, {sessions: 1, last: workout.date});
      else {
        current.sessions++;
        if (workout.date > current.last) current.last = workout.date;
      }
    }
  return stats;
}
/** Unique workouts containing the exercise: the same count as the Exercises list. */
export function exerciseWorkoutCount(dataset: Dataset, name: string): number {
  return dataset.workouts.filter((workout) =>
    workout.exercises.some((exercise) => exercise.name === name),
  ).length;
}
export type ExerciseSort = 'az' | 'most';
/** A stored sort preference; anything unknown or missing falls back to A–Z. */
export function parseExerciseSort(value: string | null): ExerciseSort {
  return value === 'most' ? 'most' : 'az';
}
/** A–Z, or most unique workouts first with name ties A–Z; never-done names stay last. */
export function sortExerciseNames(
  names: readonly string[],
  stats: ReadonlyMap<string, ExerciseStat>,
  sort: ExerciseSort,
): string[] {
  const byName = (a: string, b: string) => a.localeCompare(b);
  if (sort === 'az') return [...names].sort(byName);
  const count = (name: string) => stats.get(name)?.sessions ?? 0;
  return [...names].sort((a, b) => count(b) - count(a) || byName(a, b));
}
export function getHistory(dataset: Dataset, name: string): ExerciseSession[] {
  return dataset.workouts
    .flatMap((workout) =>
      workout.exercises
        .filter((exercise) => exercise.name === name)
        .map((exercise) => ({
          workoutId: workout.id,
          workoutName: workout.name,
          date: workout.date,
          type: exercise.type,
          sets: exercise.sets,
        })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function getTrend(dataset: Dataset, name: string, metric: Metric): TrendPoint[] {
  const points = getHistory(dataset, name)
    .flatMap((session) => {
      const values = session.sets
        .map((set) =>
          metric === 'e1rm'
            ? estimate1RM(set, session.type)
            : metric === 'volume'
              ? setVolume(set, session.type)
              : metric === 'reps'
                ? set.reps
                : set.weight,
        )
        .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
      if (!values.length) return [];
      return [
        {
          workoutId: session.workoutId,
          date: session.date,
          value:
            metric === 'volume'
              ? values.reduce((total, value) => total + value, 0)
              : metric === 'load' && session.type === 'assisted'
                ? Math.min(...values)
                : Math.max(...values),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (metric !== 'volume') return points;
  const sessions = new Map<string, TrendPoint>();
  for (const point of points) {
    const existing = sessions.get(point.workoutId);
    sessions.set(point.workoutId, {...point, value: (existing?.value ?? 0) + point.value});
  }
  return [...sessions.values()];
}
/** Counted sets with reps, linked to their source workout. */
function repEvidence(sessions: ExerciseSession[]): Comparable[] {
  return sessions.flatMap((session) =>
    session.sets
      .filter((set) => set.reps !== null && set.reps > 0)
      .map((set) => ({
        set,
        workoutId: session.workoutId,
        workoutName: session.workoutName,
        date: session.date,
      })),
  );
}
/** Most reps, then newest. */
function bestReps(candidates: Comparable[]): Comparable | null {
  return (
    [...candidates].sort(
      (a, b) => (b.set.reps ?? 0) - (a.set.reps ?? 0) || b.date.localeCompare(a.date),
    )[0] ?? null
  );
}
/** Most reps at exactly this weight, from the exercise's sessions of the same type. */
export function bestComparable(
  dataset: Dataset,
  name: string,
  type: ExerciseType,
  weight: number | null,
): Comparable | null {
  return bestReps(
    repEvidence(getHistory(dataset, name).filter((session) => session.type === type)).filter(
      (entry) => entry.set.weight === weight,
    ),
  );
}
/**
 * Actual recorded sets at the closest lighter and heavier weights for the same exercise
 * and type. No conversion, interpolation or estimated equivalent; assistance stays
 * assistance. Not applicable to bodyweight, duration or cardio work.
 */
export function nearestRecorded(
  dataset: Dataset,
  name: string,
  type: ExerciseType,
  weight: number,
): {below: Comparable | null; above: Comparable | null} {
  if (type !== 'weighted' && type !== 'assisted') return {below: null, above: null};
  const evidence = repEvidence(
    getHistory(dataset, name).filter((session) => session.type === type),
  ).filter((entry) => entry.set.weight !== null && Number.isFinite(entry.set.weight));
  const nearest = (side: Comparable[], pick: (weights: number[]) => number) => {
    if (!side.length) return null;
    const target = pick(side.map((entry) => entry.set.weight!));
    return bestReps(side.filter((entry) => entry.set.weight === target));
  };
  return {
    below: nearest(
      evidence.filter((entry) => entry.set.weight! < weight),
      (weights) => Math.max(...weights),
    ),
    above: nearest(
      evidence.filter((entry) => entry.set.weight! > weight),
      (weights) => Math.min(...weights),
    ),
  };
}
export function estimate1RM(set: SetRecord, type: ExerciseType): number | null {
  if (
    type !== 'weighted' ||
    set.weight === null ||
    set.weight <= 0 ||
    set.reps === null ||
    !Number.isInteger(set.reps) ||
    set.reps < 1 ||
    set.reps > 10
  )
    return null;
  const value = set.reps === 1 ? set.weight : set.weight * (1 + set.reps / 30);
  return Number.isFinite(value) ? value : null;
}
export function setVolume(set: SetRecord, type: ExerciseType): number | null {
  if (
    type !== 'weighted' ||
    set.weight === null ||
    set.weight < 0 ||
    set.reps === null ||
    set.reps < 1
  )
    return null;
  const value = set.weight * set.reps;
  return Number.isFinite(value) ? value : null;
}

export interface RecordEntry {
  value: number;
  set: SetRecord;
  workoutId: string;
  workoutName: string;
  date: string;
}
export interface ExerciseRecords {
  /** Epley, 1–10 reps, weighted work only. */
  estimated: RecordEntry | null;
  heaviest: RecordEntry | null;
  bestSetVolume: RecordEntry | null;
  sessionVolume: {value: number; workoutId: string; workoutName: string; date: string} | null;
  leastAssistance: RecordEntry | null;
  mostReps: RecordEntry | null;
  /** Heaviest recorded weight for each exact rep count (weighted work only). */
  repBests: (RecordEntry & {reps: number})[];
}
/** Every record links back to the exact set that produced it. */
export function getRecords(dataset: Dataset, name: string): ExerciseRecords {
  const history = getHistory(dataset, name);
  const best = (
    pick: (set: SetRecord, type: ExerciseType) => number | null,
    better: (a: number, b: number) => boolean = (a, b) => a > b,
  ): RecordEntry | null => {
    let found: RecordEntry | null = null;
    // Oldest first, so ties keep the first time a record was reached.
    for (const session of [...history].reverse())
      for (const set of session.sets) {
        const value = pick(set, session.type);
        if (value === null || !Number.isFinite(value)) continue;
        if (!found || better(value, found.value))
          found = {
            value,
            set,
            workoutId: session.workoutId,
            workoutName: session.workoutName,
            date: session.date,
          };
      }
    return found;
  };
  const positive = (n: number | null) => (n !== null && n > 0 ? n : null);
  const weightedReps = (set: SetRecord) =>
    set.weight !== null && set.weight > 0 && set.reps !== null && set.reps >= 1;
  let sessionVolume: ExerciseRecords['sessionVolume'] = null;
  const volumes = new Map<string, NonNullable<ExerciseRecords['sessionVolume']>>();
  for (const session of [...history].reverse()) {
    const total = session.sets.reduce((sum, set) => sum + (setVolume(set, session.type) ?? 0), 0);
    const existing = volumes.get(session.workoutId);
    if (total > 0)
      volumes.set(session.workoutId, {
        value: (existing?.value ?? 0) + total,
        workoutId: session.workoutId,
        workoutName: session.workoutName,
        date: session.date,
      });
  }
  for (const volume of volumes.values())
    if (!sessionVolume || volume.value > sessionVolume.value) sessionVolume = volume;
  const reps = new Map<number, RecordEntry & {reps: number}>();
  for (const session of [...history].reverse())
    if (session.type === 'weighted')
      for (const set of session.sets)
        if (weightedReps(set) && Number.isInteger(set.reps)) {
          const current = reps.get(set.reps!);
          if (!current || set.weight! > current.value)
            reps.set(set.reps!, {
              reps: set.reps!,
              value: set.weight!,
              set,
              workoutId: session.workoutId,
              workoutName: session.workoutName,
              date: session.date,
            });
        }
  return {
    estimated: best((set, type) => estimate1RM(set, type)),
    heaviest: best((set, type) => (type === 'weighted' && weightedReps(set) ? set.weight : null)),
    bestSetVolume: best((set, type) => positive(setVolume(set, type))),
    sessionVolume,
    leastAssistance: best(
      (set, type) =>
        type === 'assisted' && set.weight !== null && set.weight >= 0 && (set.reps ?? 0) >= 1
          ? set.weight
          : null,
      (a, b) => a < b,
    ),
    mostReps: best((set, type) => (isTimed(type) ? null : positive(set.reps))),
    repBests: [...reps.values()].sort((a, b) => a.reps - b.reps),
  };
}

const weekStart = (date: Date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};
/** Sessions per Monday-based local week; workout timestamps are local wall time. */
export function workoutsPerWeek(
  workouts: Workout[],
  weeks: number,
  now = new Date(),
): {start: string; count: number}[] {
  const current = weekStart(now);
  const buckets = Array.from({length: weeks}, (_, i) => {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    return {start: localDay(start), count: 0};
  });
  const index = new Map(buckets.map((bucket, i) => [bucket.start, i]));
  for (const workout of workouts) {
    const [y, m, d] = workout.date.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) continue;
    const i = index.get(localDay(weekStart(new Date(y, m - 1, d))));
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}
