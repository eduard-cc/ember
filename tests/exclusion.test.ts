import {describe, expect, it} from 'vitest';

import {getRecords, withSetExcluded} from '../src/domain/model';
import type {Dataset, SetRecord, Workout} from '../src/domain/types';

const set = (id: string, weight: number, reps: number, extra = {}): SetRecord => ({
  id,
  weight,
  reps,
  seconds: null,
  distance: null,
  ...extra,
});
const workout = (id: string, date: string, sets: SetRecord[]): Workout => ({
  id,
  name: 'Synthetic ' + id,
  date,
  duration: 30,
  exercises: [{name: 'Press', type: 'weighted', sets}],
});
const dataset = (workouts: Workout[]): Dataset => ({
  sourceLabel: 'Synthetic',
  workouts,
  warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
});

describe('withSetExcluded', () => {
  const typo = set('typo', 40, 60, {suspicious: true, original: {Reps: '60', Weight: '40'}});
  const source = workout('w', '2026-02-01T10:00:00', [set('a', 40, 8), typo]);

  it('marks only the chosen set and keeps every raw value, id and order', () => {
    const excluded = withSetExcluded(source, 'typo', true);
    expect(excluded.exercises[0].sets).toEqual([set('a', 40, 8), {...typo, excluded: true}]);
    expect({...excluded, exercises: []}).toEqual({...source, exercises: []});
    // The input document is not mutated.
    expect(source.exercises[0].sets[1].excluded).toBeUndefined();
  });

  it('including again restores the original document exactly', () => {
    const restored = withSetExcluded(withSetExcluded(source, 'typo', true), 'typo', false);
    expect(restored).toEqual(source);
    expect('excluded' in restored.exercises[0].sets[1]).toBe(false);
  });

  it('refuses a missing or ambiguous set id instead of guessing', () => {
    expect(() => withSetExcluded(source, 'missing', true)).toThrow();
    const twice = workout('d', '2026-02-01T10:00:00', [set('dup', 1, 1), set('dup', 2, 2)]);
    expect(() => withSetExcluded(twice, 'dup', true)).toThrow();
  });

  it('drops an excluded set out of records and restores it when included', () => {
    const history = [workout('old', '2026-01-01T10:00:00', [set('real', 40, 12)]), source];
    expect(getRecords(dataset(history), 'Press').mostReps?.set.id).toBe('typo');
    const excluded = [history[0], withSetExcluded(source, 'typo', true)];
    expect(getRecords(dataset(excluded), 'Press').mostReps?.set.id).toBe('real');
    expect(getRecords(dataset(excluded), 'Press').mostReps?.value).toBe(12);
    const included = [history[0], withSetExcluded(excluded[1], 'typo', false)];
    expect(getRecords(dataset(included), 'Press').mostReps?.value).toBe(60);
  });
});
