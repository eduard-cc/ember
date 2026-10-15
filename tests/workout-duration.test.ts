import {describe, expect, it} from 'vitest';

import type {Workout} from '../src/domain/types';
import {elapsedMinutes} from '../src/domain/workout-duration';
import {newWorkout} from '../src/state/workout';

describe('workout elapsed minutes', () => {
  it.each([
    ['normal session', '2026-01-10T12:00:00', '2026-01-10T12:45:00', 45],
    ['across midnight', '2026-01-10T23:50:00', '2026-01-11T00:35:00', 45],
    ['sub-minute session', '2026-01-10T12:00:00', '2026-01-10T12:00:59', 0],
    ['whole elapsed minutes', '2026-01-10T12:00:00', '2026-01-10T12:45:59', 45],
    ['exact minute boundary', '2026-01-10T12:00:00', '2026-01-10T12:01:00', 1],
    ['clock earlier than start', '2026-01-10T12:00:00', '2026-01-10T11:50:00', 0],
    ['unknown start', '', '2026-01-10T12:45:00', 0],
  ])('%s', (_label, start, finish, expected) => {
    expect(elapsedMinutes(start, new Date(finish).getTime())).toBe(expected);
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
