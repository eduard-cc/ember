import {z} from 'zod';

import {type BodyWeight, BodyWeightSchema} from './body-weight.js';
import {id} from './fields.js';
import {type WorkoutDocument, WorkoutSchema} from './workouts.js';

export const OperationKindSchema = z.enum([
  'putBodyWeight',
  'putWorkout',
  'putTemplate',
  'deleteTemplate',
  'putImportedWorkout',
  'deleteImportedWorkout',
  'deleteWorkout',
]);
export type OperationKind = z.infer<typeof OperationKindSchema>;
const DELETE_KINDS: readonly string[] = [
  'deleteTemplate',
  'deleteImportedWorkout',
  'deleteWorkout',
];
export const isDeleteKind = (kind: string) => DELETE_KINDS.includes(kind);

/** A sync operation's fields, before the per-kind payload rule; extend it, then add that rule. */
export const OperationSchema = z.strictObject({
  operationId: z.uuid(),
  entityId: id,
  kind: OperationKindSchema,
  expectedRevision: z.number().int().nonnegative().nullable(),
  payload: z.union([WorkoutSchema, BodyWeightSchema]).nullable(),
});

/**
 * Deletes carry no payload; every other kind carries the document it names, of the matching
 * type. Use as `superRefine` on `OperationSchema` or an extension of it.
 */
export function checkOperationPayload(
  operation: {kind: OperationKind; entityId: string; payload: unknown},
  context: z.RefinementCtx,
) {
  const {kind, entityId, payload} = operation;
  const valid = isDeleteKind(kind)
    ? payload === null
    : payload !== null &&
      (kind === 'putBodyWeight' ? BodyWeightSchema : WorkoutSchema).safeParse(payload).success &&
      (payload as {id: string}).id === entityId;
  if (!valid)
    context.addIssue({
      code: 'custom',
      message: 'Payload must match operation kind and entity identity',
    });
}

/** An operation the web app queues in its outbox. */
export const LocalOperationSchema = OperationSchema.superRefine(checkOperationPayload);
export interface LocalOperation {
  operationId: string;
  entityId: string;
  kind: OperationKind;
  expectedRevision: number | null;
  /** A BodyWeight only for putBodyWeight; validated per kind by LocalOperationSchema. */
  payload: WorkoutDocument | BodyWeight | null;
}
