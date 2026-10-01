import {z} from 'zod';

import type {Workout} from '../src/domain/types';

// Source occurrence IDs are opaque strings, not UUIDs. Never normalize them.
const id = z.string().min(1);
const number = z.number().finite().nullable();
// Validate local wall-time syntax/calendar without converting persisted timestamps.
// Empty dates are supported for the legacy editable template documents.
const date = z
  .string()
  .refine(
    (value) =>
      value === '' ||
      (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + 'Z')) &&
        new Date(value + 'Z').toISOString().slice(0, 19) === value),
    'Invalid local timestamp',
  );
export const SetRecordSchema = z
  .object({
    id,
    weight: number,
    reps: number,
    seconds: number,
    distance: number,
    completed: z.boolean().optional(),
    excluded: z.boolean().optional(),
    suspicious: z.boolean().optional(),
    original: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export const WorkoutSchema = z
  .object({
    id,
    name: z.string(),
    date,
    duration: z.number().finite().nonnegative(),
    exercises: z.array(
      z
        .object({
          name: z.string(),
          type: z.enum(['weighted', 'assisted', 'bodyweight', 'duration', 'cardio']),
          sets: z.array(SetRecordSchema),
        })
        .strict(),
    ),
  })
  .strict();
export const DatasetSchema = z
  .object({
    sourceLabel: z.string(),
    workouts: z.array(WorkoutSchema),
    warnings: z
      .object({
        duplicateRows: z.number().int().nonnegative(),
        duplicateKeys: z.number().int().nonnegative(),
        suspiciousRows: z.number().int().nonnegative(),
        unparsedRows: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const AppStateSchema = z
  .object({
    version: z.literal(1),
    dataset: DatasetSchema.nullable(),
    active: WorkoutSchema.nullable(),
    finished: z.array(WorkoutSchema),
    templates: z.array(WorkoutSchema).nullable(),
  })
  .strict();
export interface LocalOperation {
  operationId: string;
  entityId: string;
  kind:
    | 'putWorkout'
    | 'putTemplate'
    | 'deleteTemplate'
    | 'putImportedWorkout'
    | 'deleteImportedWorkout';
  expectedRevision: number | null;
  payload: Workout | null;
}
export const LocalOperationSchema = z
  .object({
    operationId: z.uuid(),
    entityId: id,
    kind: z.enum([
      'putWorkout',
      'putTemplate',
      'deleteTemplate',
      'putImportedWorkout',
      'deleteImportedWorkout',
    ]),
    expectedRevision: z.number().int().nonnegative().nullable(),
    payload: WorkoutSchema.nullable(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      operation.kind === 'deleteTemplate' || operation.kind === 'deleteImportedWorkout'
        ? operation.payload !== null
        : operation.payload === null || operation.payload.id !== operation.entityId
    )
      context.addIssue({
        code: 'custom',
        message: 'Payload must match operation kind and entity identity',
      });
  });
