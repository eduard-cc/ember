import {z} from 'zod';

import {id, localDate, nullableNumber} from './fields.js';
import {RETIRED_SET_KEYS, withoutKeys} from './retired-keys.js';

export const SetRecordSchema = z.preprocess(
  withoutKeys(RETIRED_SET_KEYS),
  z.strictObject({
    id,
    weight: nullableNumber,
    reps: nullableNumber,
    seconds: nullableNumber,
    distance: nullableNumber,
    completed: z.boolean().optional(),
    original: z.record(z.string(), z.string()).optional(),
  }),
);
export const ExerciseSchema = z.strictObject({
  name: z.string(),
  type: z.enum(['weighted', 'assisted', 'bodyweight', 'duration', 'cardio']),
  sets: z.array(SetRecordSchema),
});
/** A finished, imported, template or active workout document. */
export const WorkoutSchema = z.strictObject({
  id,
  name: z.string(),
  date: localDate,
  duration: z.number().finite().nonnegative(),
  exercises: z.array(ExerciseSchema),
});
export type WorkoutDocument = z.infer<typeof WorkoutSchema>;
/** The unfinished workout kept on one device: a workout plus the template it was started from. */
export const DraftWorkoutSchema = WorkoutSchema.extend({templateId: id.optional()});
