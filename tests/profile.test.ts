import {describe, expect, it} from 'vitest';

import {workoutsPerWeek} from '../src/domain/model';
import {bodyPartSets, minutesLabel, recentRecords, weekComparison} from '../src/domain/profile';
import type {Dataset, ExerciseLog, SetRecord, Workout} from '../src/domain/types';

const set = (
  id: string,
  weight: number | null,
  reps: number | null,
  completed = true,
): SetRecord => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  completed,
});
const workout = (id: string, date: string, exercises: ExerciseLog[], duration = 45): Workout => ({
  id,
  name: 'Synthetic ' + id,
  date,
  duration,
  exercises,
});
const press = (...sets: SetRecord[]): ExerciseLog => ({name: 'Press', type: 'weighted', sets});
const dataset = (workouts: Workout[]): Dataset => ({
  sourceLabel: 'Synthetic',
  workouts: [...workouts].sort((a, b) => b.date.localeCompare(a.date)),
  warnings: {duplicateRows: 0, duplicateKeys: 0, unparsedRows: 0},
});

describe('weekly comparison', () => {
  // Thursday 12 November 2026; the running week starts Monday 9 November.
  const now = new Date(2026, 10, 12, 20);
  const on = (id: string, day: string) => workout(id, `${day}T18:00:00`, [press(set(id, 60, 8))]);

  it('compares the last full week with the median of the full weeks before it since history began', () => {
    const workouts = [
      // History begins in the week of 12 Oct; earlier weeks in range are not zero weeks.
      on('a', '2026-10-13'),
      on('b', '2026-10-15'),
      on('c', '2026-10-20'),
      // 26 Oct: none (a real zero week), 2 Nov: last full week with three.
      on('d', '2026-11-02'),
      on('e', '2026-11-04'),
      on('f', '2026-11-06'),
      // This week so far.
      on('g', '2026-11-10'),
    ];
    const weeks = workoutsPerWeek(workouts, 8, now);
    expect(weeks.at(-1)).toMatchObject({start: '2026-11-09', count: 1, workouts: ['g']});
    expect(weekComparison(weeks, 'count', '2026-10-13T18:00:00')).toEqual({
      last: weeks.length - 2,
      // Median of 2 (12 Oct), 1 (19 Oct) and 0 (26 Oct).
      usual: 1,
    });
  });

  it('has no usual value until two full weeks precede the last one', () => {
    const workouts = [on('a', '2026-10-27'), on('b', '2026-11-03'), on('c', '2026-11-10')];
    const weeks = workoutsPerWeek(workouts, 13, now);
    expect(weekComparison(weeks, 'time', '2026-10-27T18:00:00')).toEqual({
      last: weeks.length - 2,
      usual: null,
    });
  });

  it('has no last full week while all history is in the running week', () => {
    const weeks = workoutsPerWeek([on('a', '2026-11-10')], 13, now);
    expect(weekComparison(weeks, 'volume', '2026-11-10T18:00:00')).toEqual({
      last: null,
      usual: null,
    });
  });
});

describe('minutes label', () => {
  it('reads whole hours and minutes, keeping a sub-minute total distinguishable from none', () => {
    expect(minutesLabel(0)).toBe('0 min');
    expect(minutesLabel(0.25)).toBe('<1 min');
    expect(minutesLabel(0.75)).toBe('<1 min');
    expect(minutesLabel(59 / 60)).toBe('<1 min');
    expect(minutesLabel(1)).toBe('1 min');
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(65)).toBe('1 h 5 min');
    // A median of 119 and 120 rounds to the hour instead of reading "1 h 60 min".
    expect(minutesLabel(119.5)).toBe('2 h');
  });
});

describe('recent records', () => {
  const now = new Date(2026, 10, 12, 20);
  it('lists each exercise once, newest first, with the gain over its best before the window', () => {
    const history = dataset([
      workout('old', '2026-09-01T18:00:00', [press(set('o1', 80, 5))]),
      // Beaten twice inside the last 28 days: the gain counts from 80 kg.
      workout('w1', '2026-10-20T18:00:00', [press(set('w1', 82.5, 5))]),
      workout('w2', '2026-11-05T18:00:00', [press(set('w2', 85, 5))]),
      // A first session sets no record.
      workout('new', '2026-11-10T18:00:00', [
        {name: 'Squat (Barbell)', type: 'weighted', sets: [set('n1', 100, 5)]},
      ]),
      // Outside the window.
      workout('before', '2026-10-01T18:00:00', [
        {name: 'Pull Up', type: 'bodyweight', sets: [set('p1', null, 8)]},
      ]),
      workout('first', '2026-08-01T18:00:00', [
        {name: 'Pull Up', type: 'bodyweight', sets: [set('p0', null, 6)]},
      ]),
    ]);
    expect(recentRecords(history, now)).toEqual([
      {
        exercise: 'Press',
        kind: 'weight',
        value: 85,
        previous: 80,
        workoutId: 'w2',
        date: '2026-11-05T18:00:00',
      },
    ]);
  });
});

describe('sets per body part', () => {
  const now = new Date(2026, 10, 12, 20);
  const partOf = (name: string) =>
    name === 'Press' ? 'Chest' : name === 'Squat' ? 'Legs' : 'Other';
  const squat = (...sets: SetRecord[]): ExerciseLog => ({name: 'Squat', type: 'weighted', sets});
  it('counts completed sets in the last 4 weeks against the median of earlier 4-week blocks', () => {
    const workouts = [
      // Last 28 days (16 Oct – 12 Nov): a press set, an imported one with no completed flag, and
      // two squat sets. Stored history keeps only recorded sets, so every stored set counts.
      workout('a', '2026-11-12T07:00:00', [
        press(set('a1', 60, 8), {...set('a2', 60, 8), completed: undefined}),
      ]),
      workout('b', '2026-10-16T18:00:00', [squat(set('b1', 100, 5), set('b2', 100, 5))]),
      // 18 Sep – 15 Oct: three press sets.
      workout('c', '2026-10-15T18:00:00', [
        press(set('c1', 60, 8), set('c2', 60, 8), set('c3', 60, 8)),
      ]),
      // 21 Aug – 17 Sep: one press set and an unknown exercise.
      workout('d', '2026-09-01T18:00:00', [
        press(set('d1', 60, 8)),
        {name: 'Mystery', type: 'weighted', sets: [set('d2', 10, 10)]},
      ]),
    ];
    expect(bodyPartSets(workouts, now, partOf)).toEqual([
      {part: 'Chest', sets: 2, usual: 2},
      {part: 'Legs', sets: 2, usual: 0},
      {part: 'Other', sets: 0, usual: 0.5},
    ]);
  });
  it('has no usual value until two earlier blocks have training', () => {
    const workouts = [
      workout('a', '2026-11-10T18:00:00', [press(set('a1', 60, 8))]),
      workout('b', '2026-10-10T18:00:00', [press(set('b1', 60, 8))]),
    ];
    expect(bodyPartSets(workouts, now, partOf)).toEqual([{part: 'Chest', sets: 1, usual: null}]);
  });
  it('is empty when the last 4 weeks have no sets, whatever came before', () => {
    const workouts = [
      workout('a', '2026-10-10T18:00:00', [press(set('a1', 60, 8))]),
      workout('b', '2026-09-10T18:00:00', [press(set('b1', 60, 8))]),
    ];
    expect(bodyPartSets(workouts, now, partOf)).toEqual([]);
  });
});
