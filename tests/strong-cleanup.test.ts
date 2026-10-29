import {describe, expect, it} from 'vitest';

import {parseStrongCsv} from '../src/domain/model';
import {cleanStrongCsv} from '../src/domain/strong-cleanup';

const header =
  'Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration';
const row = (date: string, workout: string, exercise: string, order: number, reps: number) =>
  `${date};"${workout}";"${exercise}";${order};50;kg;${reps};;;;0;"";"";40m`;
const csv = (...rows: string[]) => [header, ...rows].join('\n') + '\n';

const doubled = [
  row('2030-01-01 10:00:00', 'Demo A', 'Synthetic Press', 1, 8),
  row('2030-01-01 10:00:00', 'Demo A', 'Synthetic Press', 2, 7),
  row('2030-01-01 10:00:00', 'Demo A', 'Synthetic Row', 1, 10),
];
// The same exercise twice with different sets is real training and stays.
const repeatedExercise = [
  row('2030-01-02 10:00:00', 'Demo B', 'Synthetic Curl', 1, 12),
  row('2030-01-02 10:00:00', 'Demo B', 'Synthetic Curl', 1, 11),
];
// Odd length, and an even-length workout whose halves differ.
const oddLength = [
  row('2030-01-03 10:00:00', 'Demo C', 'Synthetic Squat', 1, 5),
  row('2030-01-03 10:00:00', 'Demo C', 'Synthetic Squat', 1, 5),
  row('2030-01-03 10:00:00', 'Demo C', 'Synthetic Squat', 1, 5),
];
const differentHalves = [
  row('2030-01-04 10:00:00', 'Demo D', 'Synthetic Fly', 1, 10),
  row('2030-01-04 10:00:00', 'Demo D', 'Synthetic Fly', 2, 10),
  row('2030-01-04 10:00:00', 'Demo D', 'Synthetic Fly', 1, 10),
  row('2030-01-04 10:00:00', 'Demo D', 'Synthetic Fly', 2, 9),
];
// Halves that differ only in a set note are not a repeat: the note is real data.
const noteOnlyInSecond = [
  row('2030-01-06 10:00:00', 'Demo F', 'Synthetic Dip', 1, 8),
  row('2030-01-06 10:00:00', 'Demo F', 'Synthetic Dip', 1, 8).replace(
    ';"";"";40m',
    ';"felt easy";"";40m',
  ),
];
const typo = row('2030-01-05 10:00:00', 'Demo E', 'Synthetic Extension', 1, 101);
const source = csv(
  ...doubled,
  ...doubled,
  ...repeatedExercise,
  ...oddLength,
  ...differentHalves,
  ...noteOnlyInSecond,
  typo,
  row('2030-01-05 10:00:00', 'Demo E', 'Synthetic Extension', 2, 10),
);
const fixes = {
  fixes: [
    {
      id: 'duplicate-workouts',
      workouts: ['2030-01-01 10:00:00 Demo A'],
      expected_removed_sets: 3,
    },
    {id: 'rep-typos', changes: [['2030-01-05', 'Synthetic Extension', 101, 10]]},
    {
      id: 'drop-exercise-block',
      date: '2030-01-04',
      workout: 'Demo D',
      exercise: 'Synthetic Fly',
      block: 1,
      expected_sets: 2,
    },
    {id: 'keep-as-is', rule: 'documentation only'},
  ],
};

describe('one-time Strong export cleanup', () => {
  it('halves exactly repeated workouts, corrects listed reps and drops a named block', () => {
    const {csv: cleaned, report} = cleanStrongCsv(source, fixes);
    expect(cleaned).toBe(
      csv(
        ...doubled,
        ...repeatedExercise,
        ...oddLength,
        ...differentHalves.slice(2),
        ...noteOnlyInSecond,
        '2030-01-05 10:00:00;Demo E;Synthetic Extension;1;50;kg;10;;;;0;;;40m',
        row('2030-01-05 10:00:00', 'Demo E', 'Synthetic Extension', 2, 10),
      ),
    );
    expect(report).toEqual({
      rowsBefore: 19,
      rowsAfter: 14,
      workoutsBefore: 6,
      workoutsAfter: 6,
      duplicateWorkouts: [{workout: '2030-01-01 10:00:00 Demo A', removedSets: 3, listed: true}],
      repChanges: [{date: '2030-01-05', exercise: 'Synthetic Extension', from: 101, to: 10}],
      droppedBlocks: [
        {
          workout: '2030-01-04 10:00:00 Demo D',
          exercise: 'Synthetic Fly',
          block: 1,
          removedSets: 2,
        },
      ],
    });
    const parsed = parseStrongCsv(cleaned).workouts;
    expect(parsed).toHaveLength(6);
    expect(parsed.flatMap((w) => w.exercises.flatMap((e) => e.sets))).toHaveLength(14);
  });

  it('applies the generic duplicate rule to workouts the fixes file does not list', () => {
    const {report} = cleanStrongCsv(source, {fixes: [{id: 'duplicate-workouts'}]});
    expect(report.rowsAfter).toBe(16);
    expect(report.duplicateWorkouts).toEqual([
      {workout: '2030-01-01 10:00:00 Demo A', removedSets: 3, listed: false},
    ]);
  });

  it.each([
    [
      'a correction target that is missing',
      {fixes: [{id: 'rep-typos', changes: [['2030-01-05', 'Synthetic Extension', 99, 9]]}]},
      /matches 0 rows/,
    ],
    [
      'an ambiguous correction target',
      {fixes: [{id: 'rep-typos', changes: [['2030-01-03', 'Synthetic Squat', 5, 6]]}]},
      /matches 3 rows/,
    ],
    [
      'a listed duplicate workout that is not an exact repeat',
      {fixes: [{id: 'duplicate-workouts', workouts: ['2030-01-04 10:00:00 Demo D']}]},
      /not found/,
    ],
    [
      'a duplicate count that differs from the approval',
      {fixes: [{id: 'duplicate-workouts', expected_removed_sets: 4}]},
      /expected 4/,
    ],
    [
      'a block whose size differs from the approval',
      {fixes: [{...fixes.fixes[2], expected_sets: 3}]},
      /expected 3/,
    ],
    ['an unknown fix', {fixes: [{id: 'merge-exercises'}]}, /unknown fix/],
  ])('refuses %s', (_, file, message) => {
    expect(() => cleanStrongCsv(source, file)).toThrow(message);
  });
});
