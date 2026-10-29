import {z} from 'zod';

const id = z.string().min(1).max(512);
const numeric = z.number().finite().nullable();
// Match the browser contract without normalizing persisted local wall times.
// Empty dates remain valid for legacy editable template documents.
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
// Older clients and stored documents may still carry the retired `excluded`/`suspicious`
// set flags: accept them and drop them, so they are never stored again.
const set = z.preprocess(
	(value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
		const {excluded: _excluded, suspicious: _suspicious, ...rest} = value as Record<string, unknown>;
		return rest;
	},
	z.strictObject({
		id,
		weight: numeric,
		reps: numeric,
		seconds: numeric,
		distance: numeric,
		completed: z.boolean().optional(),
		original: z.record(z.string(), z.string()).optional(),
	}),
);
export const workout = z.strictObject({
	id,
	name: z.string().min(1).max(1000),
	date,
	duration: z.number().finite().nonnegative(),
	exercises: z
		.array(
			z.strictObject({
				name: z.string().min(1).max(1000),
				type: z.enum(['weighted', 'assisted', 'bodyweight', 'duration', 'cardio']),
				sets: z.array(set).max(5000),
			}),
		)
		.max(1000),
});
/** Body weight is its own record kind: never part of workouts, volume, records or imports. */
const bodyWeight = z.strictObject({
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
export const operation = z
	.strictObject({
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
		expectedRevision: z.number().int().positive().nullable(),
		payload: z.union([workout, bodyWeight]).nullable(),
	})
	.superRefine((o, ctx) => {
		if (o.kind === 'deleteTemplate' || o.kind === 'deleteImportedWorkout' || o.kind === 'deleteWorkout') {
			if (o.payload !== null || o.expectedRevision === null)
				ctx.addIssue({code: 'custom', message: 'Delete requires null payload and a revision'});
			return;
		}
		if (!o.payload || o.payload.id !== o.entityId) {
			ctx.addIssue({code: 'custom', message: 'Payload identity mismatch'});
			return;
		}
		if ((o.kind === 'putBodyWeight') !== !('exercises' in o.payload)) {
			ctx.addIssue({code: 'custom', message: 'Payload does not match operation kind'});
			return;
		}
		if ((o.kind === 'putWorkout' || o.kind === 'putImportedWorkout') && 'exercises' in o.payload) {
			const sets = o.payload.exercises.flatMap((e) => e.sets);
			if (!sets.length || sets.some((s) => s.completed === false))
				ctx.addIssue({code: 'custom', message: 'Active or empty drafts cannot sync'});
		}
	});
export const batch = z.strictObject({version: z.literal(1), operations: z.array(z.unknown()).min(1).max(50)});
