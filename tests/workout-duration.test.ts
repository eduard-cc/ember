import {describe, expect, it} from 'vitest';

import type {Workout} from '../src/domain/types';
import {durationLabel, elapsedMinutes} from '../src/domain/workout-duration';
import {newWorkout} from '../src/state/workout';

describe('workout elapsed minutes', () => {
  it.each([
    ['normal session', '2026-01-10T12:00:00', '2026-01-10T12:45:00', 45],
    ['across midnight', '2026-01-10T23:50:00', '2026-01-11T00:35:00', 45],
    ['sub-minute session keeps its seconds', '2026-01-10T12:00:00', '2026-01-10T12:00:30', 0.5],
    ['one second', '2026-01-10T12:00:00', '2026-01-10T12:00:01', 1 / 60],
    ['last second before a minute', '2026-01-10T12:00:00', '2026-01-10T12:00:59', 59 / 60],
    ['finished in the starting second', '2026-01-10T12:00:00', '2026-01-10T12:00:00.900', 0],
    ['whole elapsed minutes', '2026-01-10T12:00:00', '2026-01-10T12:45:59', 45],
    ['exact minute boundary', '2026-01-10T12:00:00', '2026-01-10T12:01:00', 1],
    ['clock earlier than start', '2026-01-10T12:00:00', '2026-01-10T11:50:00', 0],
    ['unknown start', '', '2026-01-10T12:45:00', 0],
  ])('%s', (_label, start, finish, expected) => {
    expect(elapsedMinutes(start, new Date(finish).getTime())).toBe(expected);
  });
});

describe('workout duration label', () => {
  it.each([
    ['unknown or zero shows nothing', 0, ''],
    ['sub-minute in-app session', 0.5, '<1 MIN'],
    ['one second', 1 / 60, '<1 MIN'],
    ['imported sub-minute duration', 0.75, '<1 MIN'],
    ['whole minutes', 45, '45 MIN'],
    ['imported fractional duration is unchanged', 62.5, '62.5 MIN'],
  ])('%s', (_label, duration, expected) => {
    expect(durationLabel(duration)).toBe(expected);
  });
});

it('repeats and templates start with zero duration and unchecked targets without changing history', () => {
  const historical: Workout = {
    id: 'synthetic-history',
    name: 'Synthetic press',
    date: '2026-01-10T12:00:00',
    duration: 62.5,
    exercises: [
      {
        name: 'Press',
        type: 'weighted',
        sets: [
          {
            id: 'synthetic-set',
            weight: 30,
            reps: 8,
            seconds: null,
            distance: null,
            completed: true,
          },
        ],
      },
    ],
  };
  const template = newWorkout(historical);
  const repeat = newWorkout(historical);
  const fromTemplate = newWorkout(template);
  for (const fresh of [template, repeat, fromTemplate]) {
    expect(fresh.duration).toBe(0);
    expect(fresh.id).not.toBe(historical.id);
    expect(fresh.exercises[0].sets[0]).toMatchObject({weight: 30, reps: 8, completed: false});
  }
  expect(historical.duration).toBe(62.5);
  expect(historical.exercises[0].sets[0].completed).toBe(true);
});

it('repeats and templates start clean of imported source evidence', () => {
  const evidence = {Date: '2026-01-03 09:00:00', 'Exercise Name': 'Press', Weight: '40', Reps: '5'};
  const historical: Workout = {
    id: 'import:synthetic:0',
    name: 'Synthetic import',
    date: '2026-01-03T09:00:00',
    duration: 50,
    exercises: [
      {
        name: 'Press',
        type: 'weighted',
        sets: [
          {
            id: 'import:synthetic:1',
            weight: 40,
            reps: 5,
            seconds: null,
            distance: null,
            original: evidence,
          },
          {
            id: 'import:synthetic:2',
            weight: 40,
            reps: 50,
            seconds: null,
            distance: null,
            original: {...evidence, Reps: '50'},
          },
        ],
      },
    ],
  };
  const repeat = newWorkout(historical);
  const fromTemplate = newWorkout(newWorkout(historical));
  for (const fresh of [repeat, fromTemplate]) {
    const [first, second] = fresh.exercises[0].sets;
    expect(first).toEqual({
      id: first.id,
      weight: 40,
      reps: 5,
      seconds: null,
      distance: null,
      completed: false,
    });
    expect(second).toEqual({
      id: second.id,
      weight: 40,
      reps: 50,
      seconds: null,
      distance: null,
      completed: false,
    });
    expect(first.id).not.toMatch(/^import:/);
  }
  expect(historical.exercises[0].sets[1].original).toEqual({...evidence, Reps: '50'});
  expect(historical.exercises[0].sets[0].original).toBe(evidence);
});
