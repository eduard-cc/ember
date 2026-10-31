import {describe, expect, it} from 'vitest';

import {newRecords, topSet, workoutVolume} from '../src/domain/finish-summary';
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

describe('personal records set by a finished workout', () => {
  const earlier = [
    session('a', '2026-03-01T10:00:00', 'weighted', [set('a1', 60, 8), set('a2', 60, 8)]),
    session('b', '2026-03-08T10:00:00', 'weighted', [set('b1', 70, 3), set('b2', 50, 12)]),
  ];
  it('reports each kind the workout beats, with the best it beat, as the Records tab defines it', () => {
    const finished = session('f', '2026-03-15T10:00:00', 'weighted', [
      set('f1', 72.5, 2),
      set('f2', 60, 10),
      set('f3', 60, 10),
    ]);
    const history = dataset([finished, ...earlier]);
    const records = newRecords(finished, history);
    expect(records).toEqual([
      {exercise: 'Press', kind: 'weight', value: 72.5, previous: 70},
      {exercise: 'Press', kind: 'volume', value: 1345, previous: 960},
      {exercise: 'Press', kind: 'e1rm', value: 80, previous: 77},
    ]);
    // The new values are exactly what the Records tab now shows for this workout.
    const after = getRecords(history, 'Press');
    expect(after.heaviest?.workoutId).toBe('f');
    expect(after.sessionVolume?.value).toBe(1345);
    expect(after.estimated?.value).toBe(80);
    expect(workoutVolume(finished)).toBe(1345);
  });
  it('reports nothing for a tie, a first session, an estimate above 10 reps, or assisted and timed work', () => {
    const tie = session('t', '2026-03-15T10:00:00', 'weighted', [set('t1', 70, 3)]);
    expect(newRecords(tie, dataset([tie, ...earlier]))).toEqual([]);
    const first = {...tie, exercises: [{...tie.exercises[0], name: 'Never done'}]};
    expect(newRecords(first, dataset([first, ...earlier]))).toEqual([]);
    // 50 × 30 beats volume only: Epley stops at 10 reps and the weight is lighter.
    const high = session('h', '2026-03-15T10:00:00', 'weighted', [set('h1', 50, 30)]);
    expect(newRecords(high, dataset([high, ...earlier])).map((r) => r.kind)).toEqual(['volume']);
    for (const type of ['assisted', 'duration', 'cardio'] as const) {
      const before = session('p' + type, '2026-03-01T10:00:00', type, [
        set('p1', 20, 5, {seconds: 30, distance: 1}),
      ]);
      const now = session('n' + type, '2026-03-15T10:00:00', type, [
        set('n1', 5, 20, {seconds: 300, distance: 5}),
      ]);
      expect(newRecords(now, dataset([now, before]))).toEqual([]);
    }
  });
  it('reports most reps for bodyweight work and sums repeated blocks into one session volume', () => {
    const before = session('p', '2026-03-01T10:00:00', 'bodyweight', [set('p1', null, 10)]);
    const now = session('n', '2026-03-15T10:00:00', 'bodyweight', [set('n1', null, 12)]);
    expect(newRecords(now, dataset([now, before]))).toEqual([
      {exercise: 'Press', kind: 'reps', value: 12, previous: 10},
    ]);
    const twice: Workout = {
      ...session('w', '2026-03-15T10:00:00', 'weighted', []),
      exercises: [
        {name: 'Press', type: 'weighted', sets: [set('w1', 60, 6), set('w2', 60, 6)]},
        {name: 'Press', type: 'weighted', sets: [set('w3', 60, 6)]},
      ],
    };
    // Each block alone (720 and 360) is below the earlier 960; together they beat it.
    expect(newRecords(twice, dataset([twice, ...earlier]))).toEqual([
      {exercise: 'Press', kind: 'volume', value: 1080, previous: 960},
    ]);
  });
});

describe('top set', () => {
  it('is the heaviest weight with the most reps at it, or the least assistance, most reps, longest hold or farthest distance', () => {
    const log = (type: ExerciseType, sets: SetRecord[]) => ({name: 'X', type, sets});
    expect(topSet(log('weighted', [set('1', 60, 10), set('2', 75, 6), set('3', 75, 8)]))?.id).toBe(
      '3',
    );
    expect(topSet(log('assisted', [set('1', 30, 10), set('2', 20, 6), set('3', 20, 8)]))?.id).toBe(
      '3',
    );
    expect(topSet(log('bodyweight', [set('1', null, 10), set('2', null, 14)]))?.id).toBe('2');
    expect(
      topSet(
        log('duration', [set('1', null, null, {seconds: 45}), set('2', null, null, {seconds: 60})]),
      )?.id,
    ).toBe('2');
    expect(
      topSet(
        log('cardio', [
          set('1', null, null, {seconds: 600, distance: 2}),
          set('2', null, null, {seconds: 500, distance: 2}),
        ]),
      )?.id,
    ).toBe('2');
  });
});
