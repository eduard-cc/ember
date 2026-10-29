import {describe, expect, it} from 'vitest';

import {
  bestComparable,
  classifyExercise,
  estimate1RM,
  getExercises,
  getHistory,
  getTrend,
  parseStrongCsv,
  setVolume,
} from '../src/domain/model';
import type {SetRecord} from '../src/domain/types';

const header =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration';
const row = '2026-01-05 18:00:00;Demo Upper;Bench Press (Barbell);1;60;kg;8;;;;0;;;50m';
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
    expect(classifyExercise('Pull Up (Assisted)', [set])).toBe('assisted');
    expect(classifyExercise('Pull Up', [{...set, weight: null}])).toBe('bodyweight');
    expect(classifyExercise('Plank', [{...set, weight: null, reps: null, seconds: 60}])).toBe(
      'duration',
    );
    expect(
      classifyExercise('Rowing (Machine)', [
        {...set, weight: null, reps: null, seconds: 300, distance: 1},
      ]),
    ).toBe('cardio');
  });
});
describe('inspectable exercise history', () => {
  it('uses least assistance for assistance-load trends and never estimates unrecorded total bodyweight strength', () => {
    const data = parseStrongCsv(
      header +
        '\n' +
        row.replace('Bench Press (Barbell)', 'Pull Up (Assisted)').replace(';60;', ';30;') +
        '\n' +
        row.replace('Bench Press (Barbell)', 'Pull Up (Assisted)').replace(';1;60;', ';2;20;'),
    );
    expect(getTrend(data, 'Pull Up (Assisted)', 'load')[0].value).toBe(20);
    expect(getTrend(data, 'Pull Up (Assisted)', 'e1rm')).toEqual([]);
    expect(getTrend(data, 'Pull Up (Assisted)', 'volume')).toEqual([]);
    expect(
      classifyExercise('Pull Up', [
        {id: 'demo', weight: 10, reps: 8, seconds: null, distance: null},
      ]),
    ).toBe('bodyweight');
  });
  it('returns chronological points with source workout IDs and best exact-load evidence without merging variants', () => {
    const data = parseStrongCsv(
      header +
        '\n' +
        row +
        '\n' +
        row.replace('2026-01-05', '2026-01-12').replace(';8;', ';10;') +
        '\n' +
        row.replace('2026-01-05', '2026-01-19').replace(';60;', ';65;') +
        '\n' +
        row.replace('Bench Press (Barbell)', 'Bench Press (Dumbbell)'),
    );
    expect(getExercises(data)).toEqual(['Bench Press (Barbell)', 'Bench Press (Dumbbell)']);
    expect(getHistory(data, 'Bench Press (Barbell)').map((s) => s.date.slice(0, 10))).toEqual([
      '2026-01-19',
      '2026-01-12',
      '2026-01-05',
    ]);
    const trend = getTrend(data, 'Bench Press (Barbell)', 'load');
    expect(trend.map((p) => p.value)).toEqual([60, 60, 65]);
    expect(trend.every((p) => data.workouts.some((w) => w.id === p.workoutId))).toBe(true);
    const best = bestComparable(data, 'Bench Press (Barbell)', 60);
    expect(best?.set.reps).toBe(10);
    expect(best?.date.slice(0, 10)).toBe('2026-01-12');
    expect(bestComparable(data, 'Bench Press (Barbell)', 62.5)).toBeNull();
    expect(getHistory(data, 'Bench Press (Barbell)')).toHaveLength(3);
  });
});
describe('Strong import', () => {
  it('rejects malformed durations and nonfinite normalized values', () => {
    for (const duration of ['nonsense', '1..2h', '-30m'])
      expect(() => parseStrongCsv(header + '\n' + row.replace('50m', duration))).toThrow();
    expect(
      parseStrongCsv(header + '\n' + row.replace('50m', '1h 2m 30s')).workouts[0].duration,
    ).toBe(62.5);
    const overflowDistance = row.replace(';8;;;;0;', ';8;;' + '17' + '0'.repeat(307) + ';mi;0;');
    expect(() => parseStrongCsv(header + '\n' + overflowDistance)).toThrow();
  });
  it('normalizes units without losing originals and keeps unusual values as recorded', () => {
    const data = parseStrongCsv(
      header +
        '\n' +
        row.replace(';60;kg;', ';100;lbs;') +
        '\n' +
        row.replace(';60;kg;8;', ';500;kg;121;').replace(';1;500;', ';2;500;'),
    );
    const sets = data.workouts[0].exercises[0].sets;
    expect(sets[0].weight).toBeCloseTo(45.359237);
    expect(sets[0].original?.Weight).toBe('100');
    expect(sets[1].weight).toBe(500);
    expect(sets[1].reps).toBe(121);
  });
  it('rejects malformed dates, invalid numbers and unknown units without inventing records', () => {
    for (const csv of [
      row.replace('2026-01-05 18:00:00', 'not-a-date'),
      row.replace(';60;kg;', ';abc;kg;'),
      row.replace(';60;kg;', ';60;stones;'),
      row.replace('2026-01-05', '2026-02-31'),
    ]) {
      expect(() => parseStrongCsv(header + '\n' + csv)).toThrow();
    }
  });
  it('parses a semicolon export into a workout while retaining duplicate occurrences and multiline quoted fields', () => {
    const data = parseStrongCsv(
      header +
        '\n' +
        row +
        '\n' +
        row +
        '\n2026-01-05 18:00:00;Demo Upper;"Cable; Row\nMachine";1;"32,5";kg;10;;;;0;;;50m',
    );
    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].duration).toBe(50);
    expect(data.workouts[0].exercises[0].sets).toHaveLength(2);
    expect(data.workouts[0].exercises[0].sets[0].id).not.toBe(
      data.workouts[0].exercises[0].sets[1].id,
    );
    expect(data.workouts[0].exercises[1].name).toBe('Cable; Row\nMachine');
    expect(data.workouts[0].exercises[1].sets[0].weight).toBe(32.5);
    expect(data.warnings.duplicateRows).toBe(1);
    expect(data.warnings.duplicateKeys).toBe(1);
  });
});
