export type ExerciseType = 'weighted' | 'assisted' | 'bodyweight' | 'duration' | 'cardio';
export interface SetRecord {
  id: string;
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  completed?: boolean;
  excluded?: boolean;
  suspicious?: boolean;
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
    suspiciousRows: number;
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
}
export interface Comparable {
  set: SetRecord;
  workoutId: string;
  workoutName: string;
  date: string;
}
