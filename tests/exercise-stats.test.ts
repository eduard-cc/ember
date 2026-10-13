import {expect, it} from 'vitest';

import {
  exerciseStats,
  exerciseWorkoutCount,
  getHistory,
  parseExerciseSort,
  sortExerciseNames,
} from '../src/domain/model';
import type {Dataset, Workout} from '../src/domain/types';

const block = (name: string) => ({name, type: 'weighted' as const, sets: []});
const workout = (id: string, date: string, names: string[]): Workout => ({
  id,
  name: id,
  date,
  duration: 0,
  exercises: names.map(block),
});
const dataset: Dataset = {
  sourceLabel: 'Synthetic fixture',
  warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
  workouts: [
    workout('a', '2026-01-01T12:00:00', ['Squat', 'Squat', 'Curl']),
    workout('b', '2026-02-01T12:00:00', ['Curl']),
    workout('c', '2026-01-15T12:00:00', ['Bench']),
  ],
};

it('counts unique workouts per exercise, not repeated blocks, and keeps the latest date', () => {
  const stats = exerciseStats(dataset);
  expect(stats.get('Squat')).toEqual({sessions: 1, last: '2026-01-01T12:00:00'});
  expect(stats.get('Curl')).toEqual({sessions: 2, last: '2026-02-01T12:00:00'});
  expect(stats.get('Bench')).toEqual({sessions: 1, last: '2026-01-15T12:00:00'});
  expect(stats.has('Row')).toBe(false);
});

it('gives the detail header the same unique-workout count as the list, not the block count', () => {
  // Squat appears as two separate blocks in workout 'a': history keeps both blocks.
  expect(getHistory(dataset, 'Squat')).toHaveLength(2);
  expect(exerciseWorkoutCount(dataset, 'Squat')).toBe(1);
  expect(exerciseWorkoutCount(dataset, 'Squat')).toBe(
    exerciseStats(dataset).get('Squat')?.sessions,
  );
  expect(exerciseWorkoutCount(dataset, 'Curl')).toBe(2);
  expect(exerciseWorkoutCount(dataset, 'Row')).toBe(0);
});

it('reads a stored sort preference, falling back to A–Z for anything unknown', () => {
  expect(parseExerciseSort('most')).toBe('most');
  expect(parseExerciseSort('az')).toBe('az');
  expect(parseExerciseSort('garbage')).toBe('az');
  expect(parseExerciseSort('')).toBe('az');
  expect(parseExerciseSort(null)).toBe('az');
});

it('sorts A–Z or by most done with name ties and never-done exercises last', () => {
  const stats = exerciseStats(dataset);
  const names = ['Row', 'Bench', 'Curl', 'Ab Wheel', 'Squat'];
  expect(sortExerciseNames(names, stats, 'az')).toEqual([
    'Ab Wheel',
    'Bench',
    'Curl',
    'Row',
    'Squat',
  ]);
  expect(sortExerciseNames(names, stats, 'most')).toEqual([
    'Curl',
    'Bench',
    'Squat',
    'Ab Wheel',
    'Row',
  ]);
  expect(names).toEqual(['Row', 'Bench', 'Curl', 'Ab Wheel', 'Squat']);
});
