import {describe, expect, it} from 'vitest';

import {nearestRecorded} from '../src/domain/model';
import type {Dataset, ExerciseType, SetRecord} from '../src/domain/types';

type Row = [
  workout: string,
  date: string,
  weight: number | null,
  reps: number | null,
  extra?: Partial<SetRecord> & {name?: string; type?: ExerciseType},
];

/** Synthetic history: one workout per row, one set each. */
function dataset(rows: Row[]): Dataset {
  return {
    sourceLabel: 'synthetic',
    warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
    workouts: rows.map(([id, date, weight, reps, extra = {}], i) => {
      const {name = 'Bench Press (Barbell)', type = 'weighted', ...set} = extra;
      return {
        id,
        name: `Workout ${id}`,
        date,
        duration: 50,
        exercises: [
          {
            name,
            type,
            sets: [{id: `set-${i}`, weight, reps, seconds: null, distance: null, ...set}],
          },
        ],
      };
    }),
  };
}
const bench = 'Bench Press (Barbell)';

describe('nearest recorded weights when the chosen weight has no history', () => {
  it('returns the closest lighter and heavier weights with their best-reps set and source', () => {
    const data = dataset([
      ['a', '2026-01-01T18:00:00', 50, 12],
      ['b', '2026-01-05T18:00:00', 60, 8],
      ['c', '2026-01-08T18:00:00', 60, 10],
      ['d', '2026-01-12T18:00:00', 70, 5],
      ['e', '2026-01-15T18:00:00', 80, 3],
    ]);
    const near = nearestRecorded(data, bench, 'weighted', 65);
    expect(near.below).toMatchObject({
      workoutId: 'c',
      workoutName: 'Workout c',
      set: {weight: 60, reps: 10},
    });
    expect(near.below?.date).toBe('2026-01-08T18:00:00');
    expect(near.above).toMatchObject({workoutId: 'd', set: {weight: 70, reps: 5}});
  });

  it('returns only the side that exists', () => {
    const data = dataset([
      ['a', '2026-01-01T18:00:00', 50, 12],
      ['b', '2026-01-05T18:00:00', 60, 8],
    ]);
    expect(nearestRecorded(data, bench, 'weighted', 70)).toMatchObject({
      below: {set: {weight: 60}},
      above: null,
    });
    expect(nearestRecorded(data, bench, 'weighted', 40)).toMatchObject({
      below: null,
      above: {set: {weight: 50}},
    });
    expect(nearestRecorded(dataset([]), bench, 'weighted', 40)).toEqual({below: null, above: null});
  });

  it('breaks rep ties by the newest set', () => {
    const data = dataset([
      ['old', '2026-01-01T18:00:00', 60, 8],
      ['new', '2026-02-01T18:00:00', 60, 8],
      ['mid', '2026-01-15T18:00:00', 60, 8],
    ]);
    expect(nearestRecorded(data, bench, 'weighted', 62.5).below?.workoutId).toBe('new');
  });

  it('ignores sets without reps', () => {
    const data = dataset([
      ['noreps', '2026-01-02T18:00:00', 63, null],
      ['zero', '2026-01-03T18:00:00', 63.5, 0],
      ['real', '2026-01-04T18:00:00', 60, 6],
    ]);
    expect(nearestRecorded(data, bench, 'weighted', 65)).toMatchObject({
      below: {workoutId: 'real'},
      above: null,
    });
  });

  it('keeps assistance as recorded assistance without conversion', () => {
    const data = dataset([
      ['a', '2026-01-01T18:00:00', 20, 8, {name: 'Pull Up (Assisted)', type: 'assisted'}],
      ['b', '2026-01-05T18:00:00', 30, 10, {name: 'Pull Up (Assisted)', type: 'assisted'}],
    ]);
    expect(nearestRecorded(data, 'Pull Up (Assisted)', 'assisted', 25)).toMatchObject({
      below: {set: {weight: 20, reps: 8}},
      above: {set: {weight: 30, reps: 10}},
    });
  });

  it('never mixes a different exercise type or variant with the same weights', () => {
    const data = dataset([
      ['bw', '2026-01-01T18:00:00', 10, 12, {name: 'Pull Up', type: 'bodyweight'}],
      ['weighted', '2026-01-02T18:00:00', 20, 5, {name: 'Pull Up', type: 'weighted'}],
      ['db', '2026-01-03T18:00:00', 14, 9, {name: 'Bench Press (Dumbbell)'}],
    ]);
    expect(nearestRecorded(data, 'Pull Up', 'weighted', 15)).toEqual({
      below: null,
      above: expect.objectContaining({workoutId: 'weighted'}),
    });
    expect(nearestRecorded(data, bench, 'weighted', 15)).toEqual({below: null, above: null});
  });

  it('treats a recorded zero load as a real weight, distinct from blank', () => {
    const data = dataset([
      ['zero', '2026-01-01T18:00:00', 0, 12],
      ['blank', '2026-01-02T18:00:00', null, 15],
      ['five', '2026-01-03T18:00:00', 5, 10],
    ]);
    expect(nearestRecorded(data, bench, 'weighted', 2.5)).toMatchObject({
      below: {workoutId: 'zero', set: {weight: 0}},
      above: {workoutId: 'five'},
    });
  });

  it('does not apply to bodyweight, duration or cardio work', () => {
    const data = dataset([
      ['bw', '2026-01-01T18:00:00', 10, 12, {name: 'Pull Up', type: 'bodyweight'}],
    ]);
    expect(nearestRecorded(data, 'Pull Up', 'bodyweight', 5)).toEqual({below: null, above: null});
    expect(nearestRecorded(data, 'Pull Up', 'duration', 5)).toEqual({below: null, above: null});
  });
});
