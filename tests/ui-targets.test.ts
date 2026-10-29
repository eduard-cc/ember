import {describe, expect, it} from 'vitest';

import {parseAppearance} from '../src/components/AppearanceSettings';
import {historyTargets, routineTargets} from '../src/components/workout-targets';
import type {Dataset, ExerciseType, SetRecord, Workout} from '../src/domain/types';

const set = (id: string, weight: number | null, reps: number | null): SetRecord => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  completed: true,
});
const workout = (id: string, date: string, type: ExerciseType, sets: SetRecord[]): Workout => ({
  id,
  name: id,
  date,
  duration: 0,
  exercises: [{name: 'Variant', type, sets}],
});
const dataset: Dataset = {
  sourceLabel: 'Synthetic fixture',
  warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
  workouts: [
    workout('old', '2026-01-01T12:00:00', 'weighted', [set('old-1', 20, 8)]),
    workout('new', '2026-02-01T12:00:00', 'weighted', [set('new-1', 50, 10), set('new-2', 45, 9)]),
    workout('wrong-type', '2026-03-01T12:00:00', 'assisted', [set('assist-1', 15, 8)]),
  ],
};

describe('UI-only unchecked historical targets', () => {
  it('copies the latest eligible exact name/type, repeats its last target, and leaves evidence immutable', () => {
    const before = structuredClone(dataset);
    const target = historyTargets(dataset, 'Variant', 'weighted', 3);
    expect(target.sets.map((s) => [s.weight, s.reps, s.completed])).toEqual([
      [50, 10, false],
      [45, 9, false],
      [45, 9, false],
    ]);
    expect(new Set(target.sets.map((s) => s.id)).size).toBe(3);
    expect(
      target.sets.some((s) =>
        dataset.workouts.some((w) =>
          w.exercises.some((e) => e.sets.some((source) => source.id === s.id)),
        ),
      ),
    ).toBe(false);
    expect(dataset).toEqual(before);
  });
  it('preserves routine counts, prefers history, and falls back to the routine values', () => {
    const template: Workout = {
      ...dataset.workouts[0],
      exercises: [
        {name: 'Variant', type: 'weighted', sets: [set('r1', 1, 1)]},
        {name: 'Variant (Dumbbell)', type: 'weighted', sets: [set('r2', 12, 15)]},
        {name: 'Unset routine lift', type: 'weighted', sets: [set('r3', null, null)]},
      ],
    };
    const target = routineTargets(template, dataset);
    expect(target.exercises[0].sets).toHaveLength(1);
    expect(target.exercises[0].sets[0]).toMatchObject({weight: 50, reps: 10, completed: false});
    expect(target.exercises[1].sets[0]).toMatchObject({weight: 12, reps: 15, completed: false});
    expect(target.exercises[1].sets[0].id).not.toBe('r2');
    expect(target.exercises[2].sets[0]).toMatchObject({weight: null, reps: null, completed: false});
    expect(template.exercises[1].sets[0]).toMatchObject({id: 'r2', weight: 12, completed: true});
  });
  it.each(['weighted', 'assisted', 'bodyweight', 'duration', 'cardio'] as const)(
    'makes blank %s targets with no evidence',
    (type) => {
      const target = historyTargets(dataset, 'Never logged', type);
      expect(target.sets).toHaveLength(type === 'duration' || type === 'cardio' ? 1 : 3);
      for (const row of target.sets)
        expect(row).toMatchObject({
          weight: null,
          reps: null,
          seconds: null,
          // Cardio keeps the pre-redesign 0 km default so time alone can be completed.
          distance: type === 'cardio' ? 0 : null,
          completed: false,
        });
    },
  );
});

describe('validated optional appearance settings', () => {
  it.each([
    null,
    '',
    '{broken',
    'null',
    '{"version":2,"theme":"dark","accent":"ocean"}',
    '{"version":1,"theme":"invalid","accent":"pine"}',
  ])('falls back safely for %s', (raw) => {
    expect(parseAppearance(raw)).toEqual({version: 1, theme: 'system'});
  });
  it('ignores a stored accent and keeps the theme', () => {
    for (const theme of ['system', 'light', 'dark'])
      for (const accent of ['pine', 'ocean', 'copper', 'invalid', undefined])
        expect(
          parseAppearance(
            JSON.stringify({version: 1, theme, accent, extra: 'not a workout setting'}),
          ),
        ).toEqual({version: 1, theme});
  });
});
