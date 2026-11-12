export type ExerciseType = 'weighted' | 'assisted' | 'bodyweight' | 'duration' | 'cardio';
export interface SetRecord {
  id: string;
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  completed?: boolean;
  original?: Record<string, string>;
}
export interface ExerciseLog {
  name: string;
  type: ExerciseType;
  sets: SetRecord[];
}
export interface Workout {
  id: string;
  name: string;
  date: string;
  duration: number;
  exercises: ExerciseLog[];
}
export interface Dataset {
  sourceLabel: string;
  workouts: Workout[];
  warnings: {
    duplicateRows: number;
    duplicateKeys: number;
    unparsedRows: number;
  };
}
export interface ExerciseSession {
  workoutId: string;
  workoutName: string;
  date: string;
  type: ExerciseType;
  sets: SetRecord[];
}
export type Metric = 'load' | 'reps' | 'e1rm' | 'volume';
export interface TrendPoint {
  workoutId: string;
  date: string;
  value: number;
  /** Actual metric-winning set; volume uses the heaviest source set. */
  best: SetRecord;
  type: ExerciseType;
  /** Strict improvement over earlier workouts; the first workout is not a PR. */
  pr: boolean;
}
export interface Comparable {
  set: SetRecord;
  workoutId: string;
  workoutName: string;
  date: string;
}
