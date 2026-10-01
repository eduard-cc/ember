import {expect, it} from 'vitest';

import {demoDataset, demoTemplates} from '../src/domain/demo';

it('offers clearly synthetic inspectable history and uncompleted editable template targets', () => {
  expect(demoDataset.sourceLabel).toBe('Demo data');
  expect(demoDataset.workouts.length).toBe(24);
  expect(demoTemplates.length).toBe(3);
  expect(demoDataset.workouts.every((workout) => workout.id.startsWith('demo-'))).toBe(true);
  expect(
    demoTemplates.every((workout) =>
      workout.exercises.every((exercise) => exercise.sets.every((set) => !set.completed)),
    ),
  ).toBe(true);
});
