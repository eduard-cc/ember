import {describe, expect, it} from 'vitest';

import {
  bestComparable,
  estimate1RM,
  getExercises,
  getHistory,
  getTrend,
  setVolume,
} from '../src/domain/model';
import type {Dataset, ExerciseType, SetRecord} from '../src/domain/types';

// Synthetic history: one workout per [date, exercise, type, weight, reps] entry.
function history(
  entries: [date: string, name: string, type: ExerciseType, weight: number, reps: number][],
): Dataset {
  const workouts = new Map<string, Dataset['workouts'][number]>();
  entries.forEach(([date, name, type, weight, reps], i) => {
    const workout = workouts.get(date) ?? {
      id: 'synthetic-' + date,
      name: 'Demo Upper',
      date: date + 'T18:00:00',
      duration: 50,
      exercises: [],
    };
    workouts.set(date, workout);
    let exercise = workout.exercises.find((e) => e.name === name);
    if (!exercise) workout.exercises.push((exercise = {name, type, sets: []}));
    exercise.sets.push({id: 'set-' + i, weight, reps, seconds: null, distance: null});
  });
  return {
    sourceLabel: 'Synthetic',
    workouts: [...workouts.values()].sort((a, b) => b.date.localeCompare(a.date)),
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  };
}
describe('exercise-specific metrics', () => {
  it('never returns nonfinite metric results', () => {
    const huge = {
      id: 'synthetic-huge',
      weight: Number('17' + '0'.repeat(307)),
      reps: 10,
      seconds: null,
      distance: null,
    };
    expect(estimate1RM(huge, 'weighted')).toBeNull();
    expect(setVolume(huge, 'weighted')).toBeNull();
  });
  const set: SetRecord = {id: 'demo-set', weight: 60, reps: 8, seconds: null, distance: null};
  it('estimates resistance performance but never treats assistance or extreme reps as resistance strength', () => {
    expect(estimate1RM(set, 'weighted')).toBe(60 * (1 + 8 / 30));
    expect(estimate1RM({...set, reps: 1}, 'weighted')).toBe(60);
    expect(estimate1RM({...set, reps: 11}, 'weighted')).toBeNull();
    expect(estimate1RM(set, 'assisted')).toBeNull();
    expect(setVolume(set, 'weighted')).toBe(480);
    expect(setVolume(set, 'assisted')).toBeNull();
  });
});
describe('inspectable exercise history', () => {
  it('uses least assistance for assistance-load trends and never estimates unrecorded total bodyweight strength', () => {
    const data = history([
      ['2026-01-05', 'Pull Up (Assisted)', 'assisted', 30, 8],
      ['2026-01-05', 'Pull Up (Assisted)', 'assisted', 20, 8],
    ]);
    expect(getTrend(data, 'Pull Up (Assisted)', 'load')[0].value).toBe(20);
    expect(getTrend(data, 'Pull Up (Assisted)', 'e1rm')).toEqual([]);
    expect(getTrend(data, 'Pull Up (Assisted)', 'volume')).toEqual([]);
  });
  it('returns chronological points with source workout IDs and best exact-load evidence without merging variants', () => {
    const data = history([
      ['2026-01-05', 'Bench Press (Barbell)', 'weighted', 60, 8],
      ['2026-01-12', 'Bench Press (Barbell)', 'weighted', 60, 10],
      ['2026-01-19', 'Bench Press (Barbell)', 'weighted', 65, 8],
      ['2026-01-05', 'Bench Press (Dumbbell)', 'weighted', 60, 8],
    ]);
    expect(getExercises(data)).toEqual(['Bench Press (Barbell)', 'Bench Press (Dumbbell)']);
    expect(getHistory(data, 'Bench Press (Barbell)').map((s) => s.date.slice(0, 10))).toEqual([
      '2026-01-19',
      '2026-01-12',
      '2026-01-05',
    ]);
    const trend = getTrend(data, 'Bench Press (Barbell)', 'load');
    expect(trend.map((p) => p.value)).toEqual([60, 60, 65]);
    expect(trend.every((p) => data.workouts.some((w) => w.id === p.workoutId))).toBe(true);
    const best = bestComparable(data, 'Bench Press (Barbell)', 'weighted', 60);
    expect(best?.set.reps).toBe(10);
    expect(best?.date.slice(0, 10)).toBe('2026-01-12');
    expect(bestComparable(data, 'Bench Press (Barbell)', 'weighted', 62.5)).toBeNull();
    expect(getHistory(data, 'Bench Press (Barbell)')).toHaveLength(3);
  });
});
