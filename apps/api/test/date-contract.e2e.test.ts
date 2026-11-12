import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {test} from 'node:test';

import {origin, setup} from './helpers';

const validDates = ['2026-01-01T10:00:00', '2024-02-29T23:59:59', '2026-03-29T02:30:00', '0000-01-01T00:00:00', ''];
const invalidDates = [
	'not-a-date',
	'2026-01-01T10:00:00Z',
	'2026-01-01T10:00:00+02:00',
	'2026-01-01T10:00:00.000',
	'2026-02-29T10:00:00',
	'2026-04-31T10:00:00',
	'2026-01-01T24:00:00',
	'2026-13-01T10:00:00',
	'2026-01-01',
];
const makeOperation = (date: string, kind: string) => {
	const id = 'date-contract-' + randomUUID();
	return {
		operationId: randomUUID(),
		entityId: id,
		kind,
		expectedRevision: null,
		payload: {
			id,
			name: 'Synthetic date contract',
			date,
			duration: 30,
			exercises: [
				{
					name: 'Press',
					type: 'weighted',
					sets: [{id: 'synthetic-set', weight: 0, reps: 5, seconds: null, distance: null, completed: true}],
				},
			],
		},
	};
};
test('sync rejects non-local or invalid calendar timestamps before they reach the feed', async () => {
	const s = await setup();
	try {
		for (const kind of ['putWorkout', 'putImportedWorkout', 'putTemplate']) {
			const operations = invalidDates.map((date) => makeOperation(date, kind));
			const result = await s.http
				.post('/api/v1/sync/operations')
				.set('Origin', origin)
				.set('Cookie', s.cookie)
				.set('X-CSRF-Token', s.csrf)
				.send({version: 1, operations})
				.expect(201);
			assert.deepEqual(
				result.body.results.map((r: any) => r.status),
				operations.map(() => 'rejected'),
				kind,
			);
			const feed = await s.http.get('/api/v1/sync/changes?after=0').set('Cookie', s.cookie).expect(200);
			assert.equal(feed.body.changes.length, 0);
		}
	} finally {
		await s.app.close();
	}
});
test('accepted local timestamps and empty legacy dates round-trip unchanged into the browser contract', async () => {
	const s = await setup();
	try {
		const operations = validDates.flatMap((date) =>
			['putWorkout', 'putImportedWorkout', 'putTemplate'].map((kind) => makeOperation(date, kind)),
		);
		const result = await s.http
			.post('/api/v1/sync/operations')
			.set('Origin', origin)
			.set('Cookie', s.cookie)
			.set('X-CSRF-Token', s.csrf)
			.send({version: 1, operations})
			.expect(201);
		assert.ok(result.body.results.every((r: any) => r.status === 'accepted'));
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + (result.body.results[0].changeSeq - 1))
			.set('Cookie', s.cookie)
			.expect(200);
		const payloads = feed.body.changes.map((c: any) => c.payload);
		assert.deepEqual(
			payloads,
			operations.map((o) => o.payload),
		);
		// Load the actual browser schema with root dependencies, without expanding the server build root.
		const parity = spawnSync(
			process.execPath,
			[
				'--import',
				resolve('node_modules/tsx/dist/loader.mjs'),
				'--input-type=module',
				'-e',
				"import {WorkoutSchema} from './shared/contracts.ts'; let input=''; for await (const chunk of process.stdin) input+=chunk; for (const payload of JSON.parse(input)) WorkoutSchema.parse(payload);",
			],
			{cwd: resolve('../web'), input: JSON.stringify(payloads), encoding: 'utf8'},
		);
		assert.equal(parity.status, 0, parity.stderr);
	} finally {
		await s.app.close();
	}
});
