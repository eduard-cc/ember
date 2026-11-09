import {type BodyPart, bodyPartOf, bodyParts} from '../catalog/catalog';
import {localDay} from '../utils/date';
import {type RecordKind, recordKinds, recordsAt} from './finish-summary';
import {weekStartOf, type workoutsPerWeek} from './model';
import type {Dataset, Workout} from './types';

/** Profile's derived views: weekly comparison, recent records and sets per body part. */

export type WeekMetric = 'count' | 'volume' | 'time';
type Week = ReturnType<typeof workoutsPerWeek>[number];

/** Minutes as "1 h 5 min"; a total under a minute reads "<1 min", none "0 min". */
export function minutesLabel(minutes: number) {
  const total = Math.round(minutes);
  if (minutes > 0 && minutes < 1) return '<1 min';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The last full week (an index into `weeks`, whose last entry is the running week) and the usual
 * week: the median of the full weeks before it, counted from the week of the first workout so
 * weeks before history began are not zero weeks. No usual value below two such weeks.
 */
export function weekComparison(
  weeks: readonly Week[],
  metric: WeekMetric,
  firstWorkout: string | undefined,
): {last: number | null; usual: number | null} {
  if (!firstWorkout) return {last: null, usual: null};
  const from = weekStartOf(firstWorkout);
  const full = weeks
    .slice(0, -1)
    .map((week, index) => ({week, index}))
    .filter(({week}) => week.start >= from);
  const last = full.at(-1)?.index ?? null;
  const earlier = full.slice(0, -1).map(({week}) => week[metric]);
  return {last, usual: earlier.length >= 2 ? median(earlier) : null};
}

/** One exercise's records over the recent window: its lead kind, best value and the best before. */
export interface RecentRecord {
  exercise: string;
  kind: RecordKind;
  value: number;
  /** The best that the window's first record of this kind beat, so the gain covers them all. */
  previous: number;
  workoutId: string;
  date: string;
}

/**
 * Records set in the last `days` days (local), one per exercise, newest first. Each workout's
 * records use `recordsAt` (beaten against everything before it, as History and the finish screen
 * show them); the lead is the first kind in `recordKinds` order, actual performance before the
 * estimate.
 */
export function recentRecords(dataset: Dataset, now = new Date(), days = 28): RecentRecord[] {
  const since = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  const today = localDay(now);
  const byExercise = new Map<string, Map<RecordKind, RecentRecord>>();
  const inWindow = dataset.workouts
    .filter((w) => w.date.slice(0, 10) > since && w.date.slice(0, 10) <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const workout of inWindow)
    for (const record of recordsAt(workout, dataset)) {
      const kinds = byExercise.get(record.exercise) ?? new Map<RecordKind, RecentRecord>();
      const before = kinds.get(record.kind);
      kinds.set(record.kind, {
        exercise: record.exercise,
        kind: record.kind,
        value: record.value,
        previous: before ? before.previous : record.previous,
        workoutId: workout.id,
        date: workout.date,
      });
      byExercise.set(record.exercise, kinds);
    }
  return [...byExercise.values()]
    .map((kinds) => kinds.get(recordKinds.find((kind) => kinds.has(kind))!)!)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface BodyPartSets {
  part: BodyPart;
  /** Recorded sets in the last 28 days, today included. */
  sets: number;
  /** Median of the six 28-day blocks before, over blocks with any training; null below two. */
  usual: number | null;
}

const DAY = 86_400_000;
const noon = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`).getTime();

/**
 * Recorded sets per catalog body part (unlisted names count as Other), in body-part order; empty
 * when the last 28 days have none.
 */
export function bodyPartSets(
  workouts: readonly Workout[],
  now = new Date(),
  partOf: (name: string) => BodyPart = bodyPartOf,
): BodyPartSets[] {
  const today = noon(localDay(now));
  const blocks = Array.from({length: 7}, () => new Map<BodyPart, number>());
  for (const workout of workouts) {
    const age = Math.round((today - noon(workout.date)) / DAY);
    const block = Math.floor(age / 28);
    if (age < 0 || block > 6) continue;
    for (const exercise of workout.exercises) {
      // Stored history holds only recorded sets (imported ones carry no completed flag).
      const sets = exercise.sets.length;
      if (!sets) continue;
      const part = partOf(exercise.name);
      blocks[block].set(part, (blocks[block].get(part) ?? 0) + sets);
    }
  }
  if (!blocks[0].size) return [];
  const trained = blocks.slice(1).filter((block) => block.size > 0);
  return bodyParts
    .map((part) => ({
      part,
      sets: blocks[0].get(part) ?? 0,
      usual: trained.length >= 2 ? median(trained.map((block) => block.get(part) ?? 0)) : null,
    }))
    .filter((row) => row.sets > 0 || (row.usual ?? 0) > 0);
}
