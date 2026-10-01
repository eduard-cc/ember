import type {Dataset, ExerciseLog, ExerciseType, Workout} from './types';

function exercise(
  name: string,
  type: ExerciseType,
  weight: number | null,
  reps: number | null,
  count = 3,
  seconds: number | null = null,
  distance: number | null = null,
): ExerciseLog {
  return {
    name,
    type,
    sets: Array.from({length: count}, (_, i) => ({
      id: `demo-${name}-${i}`,
      weight,
      reps,
      seconds,
      distance,
      completed: false,
    })),
  };
}
export const demoTemplates: Workout[] = [
  {
    id: 'demo-template-upper',
    name: 'Upper body A',
    date: '',
    duration: 0,
    exercises: [
      exercise('Bench Press (Barbell)', 'weighted', 65, 8),
      exercise('Seated Row (Cable)', 'weighted', 50, 10),
      exercise('Incline Bench Press (Dumbbell)', 'weighted', 22, 10),
      exercise('Lateral Raise (Dumbbell)', 'weighted', 10, 12),
      exercise('Pull Up (Assisted)', 'assisted', 20, 8),
    ],
  },
  {
    id: 'demo-template-lower',
    name: 'Lower body',
    date: '',
    duration: 0,
    exercises: [
      exercise('Squat (Barbell)', 'weighted', 85, 6),
      exercise('Leg Extension (Machine)', 'weighted', 45, 12),
      exercise('Lying Leg Curl (Machine)', 'weighted', 35, 10),
      exercise('Standing Calf Raise (Machine)', 'weighted', 60, 12),
    ],
  },
  {
    id: 'demo-template-pull',
    name: 'Pull + core',
    date: '',
    duration: 0,
    exercises: [
      exercise('Lat Pulldown (Cable)', 'weighted', 55, 10),
      exercise('Seated Row (Cable)', 'weighted', 50, 10),
      exercise('Bicep Curl (Dumbbell)', 'weighted', 12, 10),
      exercise('Pull Up', 'bodyweight', null, 8),
      exercise('Plank', 'duration', null, null, 2, 60),
      exercise('Rowing (Machine)', 'cardio', null, null, 1, 300, 1),
    ],
  },
];
const history: Workout[] = [];
const anchor = new Date();
anchor.setHours(18, 0, 0, 0);
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T18:00:00`;
for (let week = 0; week < 8; week++) {
  for (let day = 0; day < 3; day++) {
    const template = demoTemplates[day];
    const date = new Date(anchor);
    date.setDate(date.getDate() - (8 - week) * 7 + day * 2);
    history.push({
      ...template,
      id: `demo-workout-${week}-${day}`,
      date: localDate(date),
      duration: 48 + day * 4,
      exercises: template.exercises.map((ex, ei) => ({
        ...ex,
        sets: ex.sets.map((set, si) => ({
          ...set,
          id: `demo-${week}-${day}-${ei}-${si}`,
          completed: true,
          weight:
            set.weight === null
              ? null
              : ex.type === 'assisted'
                ? set.weight + (7 - week) * 2.5
                : Math.max(2.5, set.weight - (7 - week) * (ei === 0 ? 2.5 : 1)),
          reps: set.reps === null ? null : Math.max(1, set.reps - (si === 2 ? 2 : 0) + (week % 2)),
        })),
      })),
    });
  }
}
export const demoDataset: Dataset = {
  sourceLabel: 'Demo data',
  workouts: history.sort((a, b) => b.date.localeCompare(a.date)),
  warnings: {duplicateRows: 0, duplicateKeys: 0, suspiciousRows: 0, unparsedRows: 0},
};
