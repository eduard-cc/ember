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
/**
 * One body-weight measurement, independent of workouts. `deleted` is a reversible
 * tombstone so deletions sync and can be undone without losing revision history.
 */
export const BodyWeightSchema = z.strictObject({
  id,
  date: date.refine((value) => value !== '', 'Measurement date is required'),
  kg: z
    .number()
    .finite()
    .positive()
    .max(500)
    .refine((kg) => Number(kg.toFixed(2)) === kg, 'At most two decimals'),
  deleted: z.boolean(),
});
export type BodyWeight = z.infer<typeof BodyWeightSchema>;
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
    | 'putBodyWeight'
    | 'putWorkout'
    | 'putTemplate'
    | 'deleteTemplate'
    | 'putImportedWorkout'
    | 'deleteImportedWorkout'
    | 'deleteWorkout';
  expectedRevision: number | null;
  /** A BodyWeight only for putBodyWeight; validated per kind by LocalOperationSchema. */
  payload: Workout | BodyWeight | null;
}
export const DELETE_KINDS = ['deleteTemplate', 'deleteImportedWorkout', 'deleteWorkout'] as const;
export const isDeleteKind = (kind: string) => (DELETE_KINDS as readonly string[]).includes(kind);
export const LocalOperationSchema = z
  .object({
    operationId: z.uuid(),
    entityId: id,
    kind: z.enum([
      'putBodyWeight',
      'putWorkout',
      'putTemplate',
      'deleteTemplate',
      'putImportedWorkout',
      'deleteImportedWorkout',
      'deleteWorkout',
    ]),
    expectedRevision: z.number().int().nonnegative().nullable(),
    payload: z.union([WorkoutSchema, BodyWeightSchema]).nullable(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      isDeleteKind(operation.kind)
        ? operation.payload !== null
        : operation.payload === null ||
          operation.payload.id !== operation.entityId ||
          !(operation.kind === 'putBodyWeight' ? BodyWeightSchema : WorkoutSchema).safeParse(
            operation.payload,
          ).success
    )
      context.addIssue({
        code: 'custom',
        message: 'Payload must match operation kind and entity identity',
      });
  });
