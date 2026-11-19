import {z} from 'zod';

import {RETIRED_WARNING_KEYS, withoutKeys} from './retired-keys.js';
import {DraftWorkoutSchema, WorkoutSchema} from './workouts.js';

const DatasetSchema = z.strictObject({
  sourceLabel: z.string(),
  workouts: z.array(WorkoutSchema),
  warnings: z.preprocess(
    withoutKeys(RETIRED_WARNING_KEYS),
    z.strictObject({
      duplicateRows: z.number().int().nonnegative(),
      duplicateKeys: z.number().int().nonnegative(),
      unparsedRows: z.number().int().nonnegative(),
    }),
  ),
});
/** The web app's stored state document: imported history, the active draft, finished workouts and templates. */
export const AppStateSchema = z.strictObject({
  version: z.literal(1),
  dataset: DatasetSchema.nullable(),
  active: DraftWorkoutSchema.nullable(),
  finished: z.array(WorkoutSchema),
  templates: z.array(WorkoutSchema).nullable(),
});
