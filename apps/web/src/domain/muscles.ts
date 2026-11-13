import {type Muscle, catalogEntry, muscles} from '../catalog/catalog';
import {localDay} from '../utils/date';
import {median} from './profile';
import type {Workout} from './types';

/** Sets per muscle for Profile's Muscles card and the regions of the body figure. */

export interface MuscleTargets {
  primary: readonly Muscle[];
  secondary: readonly Muscle[];
}

/**
 * The catalog's reviewed tags. Cardio exercises keep tags for About but count toward no muscle;
 * names outside the catalog have none.
 */
export function countedTargets(name: string): MuscleTargets | null {
  const entry = catalogEntry(name);
  if (!entry || entry.bodyPart === 'Cardio') return null;
  return {primary: entry.primaryMuscles, secondary: entry.secondaryMuscles};
}

export type Region =
  | 'chest'
  | 'frontCap'
  | 'backCap'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'traps'
  | 'upperBack'
  | 'lats'
  | 'lowerBack'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves';

/**
 * Muscles each figure region shows. A shoulder cap shows its own head and the side delts (the
 * larger value wins); Hip flexors and Rotator cuff have no region and appear only in lists.
 */
export const regionMuscles: Record<Region, readonly Muscle[]> = {
  chest: ['Chest'],
  frontCap: ['Front delts', 'Side delts'],
  backCap: ['Rear delts', 'Side delts'],
  biceps: ['Biceps'],
  triceps: ['Triceps'],
  forearms: ['Forearms'],
  abs: ['Abs'],
  obliques: ['Obliques'],
  traps: ['Traps'],
  upperBack: ['Upper back'],
  lats: ['Lats'],
  lowerBack: ['Lower back'],
  glutes: ['Glutes'],
  quads: ['Quads'],
  hamstrings: ['Hamstrings'],
  adductors: ['Adductors'],
  calves: ['Calves'],
};
export const regions = Object.keys(regionMuscles) as Region[];
export const regionsOf = (muscle: Muscle) =>
  regions.filter((region) => regionMuscles[region].includes(muscle));

export interface MuscleContribution {
  exercise: string;
  role: 'primary' | 'secondary';
  /** Recorded sets of this exercise in the last 28 days. */
  sets: number;
}
export interface MuscleSets {
  muscle: Muscle;
  /** Sets in the last 28 days, today included: 1 per primary set, ½ per secondary set. */
  sets: number;
  /** Median of the six 28-day blocks before, over blocks with any training; null below two. */
  usual: number | null;
  /** Exercises behind `sets`: primary first, then by sets, then by name. */
  contributions: MuscleContribution[];
}

const DAY = 86_400_000;
const noon = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`).getTime();

/**
 * Every muscle, in `muscles` order, with its fractional sets over the last 28 days and the usual.
 * `trained` is false when the last 28 days have no sets at all.
 */
export function muscleSets(
  workouts: readonly Workout[],
  now = new Date(),
  targetsOf: (name: string) => MuscleTargets | null = countedTargets,
): {rows: MuscleSets[]; trained: boolean} {
  const today = noon(localDay(now));
  const blocks = Array.from({length: 7}, () => new Map<Muscle, number>());
  const trainedBlock = Array.from({length: 7}, () => false);
  const contributions = new Map<Muscle, Map<string, MuscleContribution>>();
  for (const workout of workouts) {
    const age = Math.round((today - noon(workout.date)) / DAY);
    const block = Math.floor(age / 28);
    // Undated workouts (allowed by the document schema) fall in no block.
    if (!Number.isFinite(age) || age < 0 || block > 6) continue;
    for (const exercise of workout.exercises) {
      // Stored history holds only recorded sets (imported ones carry no completed flag).
      const sets = exercise.sets.length;
      if (!sets) continue;
      trainedBlock[block] = true;
      const targets = targetsOf(exercise.name);
      if (!targets) continue;
      for (const [role, list, weight] of [
        ['primary', targets.primary, 1],
        ['secondary', targets.secondary, 0.5],
      ] as const)
        for (const muscle of list) {
          blocks[block].set(muscle, (blocks[block].get(muscle) ?? 0) + sets * weight);
          if (block !== 0) continue;
          const byExercise = contributions.get(muscle) ?? new Map<string, MuscleContribution>();
          const row = byExercise.get(exercise.name) ?? {exercise: exercise.name, role, sets: 0};
          row.sets += sets;
          byExercise.set(exercise.name, row);
          contributions.set(muscle, byExercise);
        }
    }
  }
  const earlier = blocks.slice(1).filter((_, i) => trainedBlock[i + 1]);
  const rows = muscles.map((muscle) => ({
    muscle,
    sets: blocks[0].get(muscle) ?? 0,
    usual: earlier.length >= 2 ? median(earlier.map((block) => block.get(muscle) ?? 0)) : null,
    contributions: [...(contributions.get(muscle)?.values() ?? [])].sort(
      (a, b) =>
        (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1) ||
        b.sets - a.sets ||
        a.exercise.localeCompare(b.exercise),
    ),
  }));
  return {rows, trained: trainedBlock[0]};
}

/** Figure tone for a 4-week total: 0 none, then steps from under 8 to 32 and more. */
export const toneEdges = [8, 16, 32] as const;
export type Tone = 0 | 1 | 2 | 3 | 4;
export function toneOf(sets: number): Tone {
  if (sets <= 0) return 0;
  if (sets < toneEdges[0]) return 1;
  if (sets < toneEdges[1]) return 2;
  if (sets < toneEdges[2]) return 3;
  return 4;
}

/** Tones per region from muscle totals; a region showing several muscles takes the larger. */
export function regionTones(rows: readonly MuscleSets[]): Record<Region, Tone> {
  const sets = new Map(rows.map((row) => [row.muscle, row.sets]));
  return Object.fromEntries(
    regions.map((region) => [
      region,
      toneOf(Math.max(...regionMuscles[region].map((m) => sets.get(m) ?? 0))),
    ]),
  ) as Record<Region, Tone>;
}
