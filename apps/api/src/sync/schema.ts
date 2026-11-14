import {
	BodyWeightSchema,
	ExerciseSchema,
	OperationSchema,
	SetRecordSchema,
	WorkoutSchema,
	checkOperationPayload,
	isDeleteKind,
} from '#contracts';
import {z} from 'zod';

// The shared document schemas plus the server's size bounds. The bounds stay here: the web
// app parses documents already stored on a device and must never newly reject them.
const MAX_ID = 512;
const boundedName = z.string().min(1).max(1000);
const set = SetRecordSchema.refine((s) => s.id.length <= MAX_ID, 'Identifier too long');
export const workout = WorkoutSchema.extend({
	id: WorkoutSchema.shape.id.max(MAX_ID),
	name: boundedName,
	exercises: z.array(ExerciseSchema.extend({name: boundedName, sets: z.array(set).max(5000)})).max(1000),
});
/** Body weight is its own record kind: never part of workouts, volume, records or imports. */
const bodyWeight = BodyWeightSchema.extend({id: BodyWeightSchema.shape.id.max(MAX_ID)});
export const operation = OperationSchema.extend({
	entityId: OperationSchema.shape.entityId.max(MAX_ID),
	expectedRevision: z.number().int().positive().nullable(),
	payload: z.union([workout, bodyWeight]).nullable(),
}).superRefine((o, ctx) => {
	checkOperationPayload(o, ctx);
	if (isDeleteKind(o.kind)) {
		if (o.expectedRevision === null) ctx.addIssue({code: 'custom', message: 'Delete requires a revision'});
		return;
	}
	if ((o.kind === 'putWorkout' || o.kind === 'putImportedWorkout') && o.payload && 'exercises' in o.payload) {
		const sets = o.payload.exercises.flatMap((e) => e.sets);
		if (!sets.length || sets.some((s) => s.completed === false))
			ctx.addIssue({code: 'custom', message: 'Active or empty drafts cannot sync'});
	}
});
export const batch = z.strictObject({version: z.literal(1), operations: z.array(z.unknown()).min(1).max(50)});
