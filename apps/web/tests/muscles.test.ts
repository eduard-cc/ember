import {describe, expect, it} from 'vitest';

import {countedTargets, muscleSets, regionTones, toneOf} from '../src/domain/muscles';
import type {ExerciseLog, SetRecord, Workout} from '../src/domain/types';

const set = (id: string): SetRecord => ({
  id,
  weight: 60,
  reps: 8,
  seconds: null,
  distance: null,
  completed: true,
});
const sets = (id: string, n: number) => Array.from({length: n}, (_, i) => set(`${id}-${i}`));
const log = (name: string, n: number, id = name): ExerciseLog => ({
  name,
  type: 'weighted',
  sets: sets(id, n),
});
const workout = (id: string, date: string, exercises: ExerciseLog[]): Workout => ({
  id,
  name: 'Synthetic ' + id,
  date,
  duration: 45,
  exercises,
});
const row = (result: ReturnType<typeof muscleSets>, muscle: string) =>
  result.rows.find((r) => r.muscle === muscle)!;

describe('sets per muscle', () => {
  // Thursday 12 November 2026: the window is 16 Oct – 12 Nov.
  const now = new Date(2026, 10, 12, 20);

  it('counts primary sets once and secondary sets half over the last 4 weeks, against the usual', () => {
    const workouts = [
      workout('a', '2026-11-12T07:00:00', [
        log('Bench Press (Barbell)', 4), // Chest; Front delts, Triceps
        log('Triceps Pushdown (Cable)', 3), // Triceps
        log('Running (Treadmill)', 1), // cardio: counts toward no muscle
        log('Synthetic Sled Drag', 2), // outside the catalog
      ]),
      workout('b', '2026-10-16T18:00:00', [log('Bench Press (Barbell)', 2, 'b')]),
      // Earlier 4-week blocks: 18 Sep – 15 Oct, then 21 Aug – 17 Sep.
      workout('c', '2026-10-15T18:00:00', [log('Bench Press (Barbell)', 3, 'c')]),
      workout('d', '2026-09-01T18:00:00', [log('Lateral Raise (Dumbbell)', 4, 'd')]),
    ];
    const result = muscleSets(workouts, now);
    expect(result.trained).toBe(true);
    expect(row(result, 'Chest')).toEqual({
      muscle: 'Chest',
      sets: 6,
      usual: 1.5,
      contributions: [{exercise: 'Bench Press (Barbell)', role: 'primary', sets: 6}],
    });
    expect(row(result, 'Triceps')).toEqual({
      muscle: 'Triceps',
      sets: 6,
      usual: 0.75,
      contributions: [
        {exercise: 'Triceps Pushdown (Cable)', role: 'primary', sets: 3},
        {exercise: 'Bench Press (Barbell)', role: 'secondary', sets: 6},
      ],
    });
    expect(row(result, 'Side delts')).toMatchObject({sets: 0, usual: 2, contributions: []});
    expect(row(result, 'Quads')).toMatchObject({sets: 0, usual: 0});
    expect(result.rows.map((r) => r.muscle)).toHaveLength(20);
  });

  it('has no usual value until two earlier blocks have training', () => {
    const result = muscleSets(
      [
        workout('a', '2026-11-10T18:00:00', [log('Bench Press (Barbell)', 1)]),
        workout('b', '2026-10-10T18:00:00', [log('Bench Press (Barbell)', 1, 'b')]),
      ],
      now,
    );
    expect(row(result, 'Chest')).toMatchObject({sets: 1, usual: null});
  });

  it('is untrained when the last 4 weeks have no sets, whatever came before', () => {
    const result = muscleSets(
      [workout('a', '2026-10-10T18:00:00', [log('Bench Press (Barbell)', 3)])],
      now,
    );
    expect(result.trained).toBe(false);
  });

  it('leaves out workouts without a date, which belong to no 4-week block', () => {
    const result = muscleSets(
      [
        workout('a', '', [log('Bench Press (Barbell)', 3)]),
        workout('b', '2026-11-10T18:00:00', [log('Bench Press (Barbell)', 1, 'b')]),
      ],
      now,
    );
    expect(result.trained).toBe(true);
    expect(row(result, 'Chest')).toMatchObject({sets: 1, usual: null});
  });

  it('takes tags from the reviewed catalog, cardio and unknown names excepted', () => {
    expect(countedTargets('Face Pull (Cable)')).toEqual({
      primary: ['Rear delts'],
      secondary: ['Upper back', 'Rotator cuff'],
    });
    expect(countedTargets('Running (Treadmill)')).toBeNull();
    expect(countedTargets('Synthetic Sled Drag')).toBeNull();
  });
});

describe('figure tones', () => {
  it('steps at 8, 16 and 32 sets; a shoulder cap shows the larger of its head and side delts', () => {
    expect([0, 0.5, 7.5, 8, 15.5, 16, 31.5, 32].map(toneOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    const result = muscleSets(
      [
        workout('a', '2026-11-12T07:00:00', [
          log('Lateral Raise (Dumbbell)', 16), // Side delts 16
          log('Face Pull (Cable)', 4), // Rear delts 4
        ]),
      ],
      new Date(2026, 10, 12, 20),
    );
    const tones = regionTones(result.rows);
    expect(tones.frontCap).toBe(3);
    expect(tones.backCap).toBe(3);
    expect(tones.upperBack).toBe(1);
    expect(tones.chest).toBe(0);
  });
});
