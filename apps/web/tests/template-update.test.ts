import {describe, expect, it} from 'vitest';

import {templateUpdate} from '../src/domain/template-update';
import type {ExerciseLog, ExerciseType, Workout} from '../src/domain/types';

const exercise = (
  name: string,
  sets: number,
  weight = 50,
  type: ExerciseType = 'weighted',
): ExerciseLog => ({
  name,
  type,
  sets: Array.from({length: sets}, (_, i) => ({
    id: `${name}-${i}`,
    weight,
    reps: 10,
    seconds: null,
    distance: null,
    completed: true,
  })),
});
const workout = (id: string, exercises: ExerciseLog[]): Workout => ({
  id,
  name: 'Synthetic push',
  date: '2026-01-05T10:00:00',
  duration: 40,
  exercises,
});
const template = workout('template-1', [
  exercise('Synthetic Press', 3, 40),
  exercise('Synthetic Fly', 3, 10),
]);

describe('template update after a finished workout', () => {
  it('offers nothing when exercises, order and set counts match, whatever the values', () => {
    const heavier = workout('w', [
      exercise('Synthetic Press', 3, 60),
      exercise('Synthetic Fly', 3),
    ]);
    expect(templateUpdate(template, heavier)).toBeNull();
  });

  it('offers the finished workout as the template when a set count changes', () => {
    const update = templateUpdate(
      template,
      workout('w', [exercise('Synthetic Press', 4, 45), exercise('Synthetic Fly', 3, 12)]),
    );
    expect(update?.removed).toEqual([]);
    expect(update?.template).toMatchObject({id: 'template-1', name: 'Synthetic push'});
    expect(update?.template.date).toBe(template.date);
    expect(update?.template.duration).toBe(template.duration);
    expect(update?.template.exercises.map((ex) => [ex.name, ex.sets.length])).toEqual([
      ['Synthetic Press', 4],
      ['Synthetic Fly', 3],
    ]);
    // Values carry over as unchecked targets with their own set ids.
    expect(update?.template.exercises[0].sets[0]).toMatchObject({
      weight: 45,
      reps: 10,
      completed: false,
    });
    expect(update?.template.exercises[0].sets[0].id).not.toBe('Synthetic Press-0');
  });

  it('offers a reorder and names nothing as removed', () => {
    const update = templateUpdate(
      template,
      workout('w', [exercise('Synthetic Fly', 3), exercise('Synthetic Press', 3)]),
    );
    expect(update?.removed).toEqual([]);
    expect(update?.template.exercises.map((ex) => ex.name)).toEqual([
      'Synthetic Fly',
      'Synthetic Press',
    ]);
  });

  it('names the template exercises a swap or skip drops, including a repeated block', () => {
    const repeated = workout('template-2', [
      exercise('Synthetic Press', 3),
      exercise('Synthetic Fly', 3),
      exercise('Synthetic Press', 2),
    ]);
    const update = templateUpdate(
      repeated,
      workout('w', [exercise('Synthetic Press', 3), exercise('Synthetic Dip', 3, 0, 'bodyweight')]),
    );
    expect(update?.removed).toEqual(['Synthetic Fly', 'Synthetic Press']);
  });

  it('treats the same name with another exercise type as a different exercise', () => {
    const update = templateUpdate(
      template,
      workout('w', [exercise('Synthetic Press', 3), exercise('Synthetic Fly', 3, 10, 'assisted')]),
    );
    expect(update?.removed).toEqual(['Synthetic Fly']);
  });
});
