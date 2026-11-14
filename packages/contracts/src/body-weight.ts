import {z} from 'zod';

import {id, localDate} from './fields.js';

/**
 * One body-weight measurement, independent of workouts. `deleted` is a reversible
 * tombstone so deletions sync and can be undone without losing revision history.
 */
export const BodyWeightSchema = z.strictObject({
  id,
  date: localDate.refine((value) => value !== '', 'Measurement date is required'),
  kg: z
    .number()
    .finite()
    .positive()
    .max(500)
    .refine((kg) => Number(kg.toFixed(2)) === kg, 'At most two decimals'),
  deleted: z.boolean(),
});
export type BodyWeight = z.infer<typeof BodyWeightSchema>;
