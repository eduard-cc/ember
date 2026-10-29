import {describe, expect, it} from 'vitest';

import {getRecords, getTrend, workoutsPerWeek} from '../src/domain/model';
import type {Dataset, ExerciseType, SetRecord, Workout} from '../src/domain/types';

const set = (id: string, weight: number | null, reps: number | null, extra = {}): SetRecord => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  ...extra,
});
const session = (id: string, date: string, type: ExerciseType, sets: SetRecord[]): Workout => ({
  id,
  name: 'Synthetic ' + id,
  date,
  duration: 0,
  exercises: [{name: 'Press', type, sets}],
});
const dataset = (workouts: Workout[]): Dataset => ({
  sourceLabel: 'Synthetic',
  workouts,
  warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
});

describe('exercise records', () => {
  it('sums session volume across repeated blocks of the same exercise in one workout', () => {
    const twice: Workout = {
      ...session('w', '2026-03-01T10:00:00', 'weighted', [set('w1', 20, 10)]),
      exercises: [
        {name: 'Press', type: 'weighted', sets: [set('w1', 20, 10)]},
        {name: 'Press', type: 'weighted', sets: [set('w2', 20, 10)]},
      ],
    };
    const single = session('s', '2026-02-01T10:00:00', 'weighted', [set('s1', 30, 10)]);
    const records = getRecords(dataset([single, twice]), 'Press');
    expect(records.sessionVolume?.value).toBe(400);
    expect(records.sessionVolume?.workoutId).toBe('w');
  });
  it('reports one volume trend point for all matching blocks in a workout', () => {
    const twice = session('w', '2026-03-01T10:00:00', 'weighted', [set('w1', 20, 10)]);
    twice.exercises.push({name: 'Press', type: 'weighted', sets: [set('w2', 20, 10)]});
    expect(getTrend(dataset([twice]), 'Press', 'volume')).toEqual([
      {workoutId: 'w', date: twice.date, value: 400},
    ]);
    expect(twice.exercises).toHaveLength(2);
  });
  it('reports weighted records with their exact source sets', () => {
    const records = getRecords(
      dataset([
        session('a', '2026-01-01T10:00:00', 'weighted', [set('a1', 100, 5), set('a2', 110, 1)]),
        session('b', '2026-02-01T10:00:00', 'weighted', [set('b1', 105, 8), set('b3', 100, 12)]),
      ]),
      'Press',
    );
    expect(records.estimated?.value).toBeCloseTo(133);
    expect(records.estimated?.set.id).toBe('b1');
    expect(records.heaviest?.set.id).toBe('a2');
    expect(records.bestSetVolume?.set.id).toBe('b3');
    expect(records.sessionVolume?.workoutId).toBe('b');
    expect(records.sessionVolume?.value).toBe(2040);
    expect(records.repBests.map((r) => [r.reps, r.set.weight])).toEqual([
      [1, 110],
      [5, 100],
      [8, 105],
      [12, 100],
    ]);
  });
  it('never applies a strength or volume formula to assisted or unweighted work', () => {
    const assisted = getRecords(
      dataset([
        session('a', '2026-01-01T10:00:00', 'assisted', [set('a1', 30, 8), set('a2', 20, 6)]),
      ]),
      'Press',
    );
    expect(assisted.estimated).toBeNull();
    expect(assisted.sessionVolume).toBeNull();
    expect(assisted.leastAssistance?.set.id).toBe('a2');
    expect(assisted.mostReps?.set.id).toBe('a1');
    const bodyweight = getRecords(
      dataset([session('a', '2026-01-01T10:00:00', 'bodyweight', [set('a1', null, 15)])]),
      'Press',
    );
    expect(bodyweight.estimated).toBeNull();
    expect(bodyweight.mostReps?.value).toBe(15);
  });
});

describe('workouts per week', () => {
  it('counts sessions in local Monday-based weeks, oldest first, including empty weeks', () => {
    const weeks = workoutsPerWeek(
      [
        session('a', '2026-09-28T07:00:00', 'weighted', []),
        session('b', '2026-10-04T23:30:00', 'weighted', []),
        session('c', '2026-10-05T06:00:00', 'weighted', []),
        session('d', '2026-09-14T12:00:00', 'weighted', []),
      ],
      4,
      new Date(2026, 9, 7, 12),
    );
    expect(weeks).toEqual([
      {start: '2026-09-14', count: 1},
      {start: '2026-09-21', count: 0},
      {start: '2026-09-28', count: 2},
      {start: '2026-10-05', count: 1},
    ]);
  });
});
