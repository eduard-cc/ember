import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

import {origin, setup} from './helpers';

const workout = (id: string) => ({
	id,
	name: 'Synthetic',
	date: '2026-01-01T10:00:00',
	duration: 30,
	exercises: [
		{
			name: 'Press',
			type: 'weighted',
			sets: [{id: 'row-1', weight: 20, reps: 5, seconds: null, distance: null, completed: true}],
		},
	],
});

// Synthetic values only.
const measurement = (id: string, patch: Record<string, unknown> = {}) => ({
	id,
	date: '2020-02-29T09:15:00',
	kg: 80.25,
	deleted: false,
	...patch,
});
const put = (id: string, expectedRevision: number | null, patch: Record<string, unknown> = {}) => ({
	operationId: randomUUID(),
	entityId: id,
	kind: 'putBodyWeight',
	expectedRevision,
	payload: measurement(id, patch),
});
async function env() {
	const s = await setup();
	return {
		...s,
		send: (operations: unknown[]) =>
			s.http
				.post('/api/v1/sync/operations')
				.set('Origin', origin)
				.set('Cookie', s.cookie)
				.set('X-CSRF-Token', s.csrf)
				.send({version: 1, operations}),
		feed: (after = 0) =>
			s.http
				.get('/api/v1/sync/changes?after=' + after + '&limit=100')
				.set('X-Sync-Body-Weight', '1')
				.set('Cookie', s.cookie)
				.expect(200),
	};
}

test('legacy clients paginate workouts without receiving measurements, upgraded clients can replay them', async () => {
	const s = await env();
	try {
		const existing = await s.feed();
		const start = existing.body.nextCursor;
		const id = 'compat-weight-' + randomUUID();
		await s.send([put(id, null)]).expect(201);
		const native = (id: string) => ({
			operationId: randomUUID(),
			entityId: id,
			kind: 'putWorkout',
			expectedRevision: null,
			payload: workout(id),
		});
		const first = native('compat-workout-' + randomUUID());
		const second = native('compat-workout-' + randomUUID());
		await s.send([first, put(id, 1, {kg: 83}), second, put(id, 2, {deleted: true})]).expect(201);
		const legacy = (after: number) =>
			s.http
				.get('/api/v1/sync/changes?after=' + after + '&limit=1')
				.set('Cookie', s.cookie)
				.expect(200);
		const page1 = (await legacy(start)).body;
		assert.deepEqual(
			page1.changes.map((c: any) => c.entityId),
			[first.entityId],
		);
		assert.equal(page1.nextCursor, page1.changes[0].changeSeq);
		assert.equal(page1.hasMore, true);
		const page2 = (await legacy(page1.nextCursor)).body;
		assert.deepEqual(
			page2.changes.map((c: any) => c.entityId),
			[second.entityId],
		);
		assert.equal(page2.hasMore, false);
		const tail = (await legacy(page2.nextCursor)).body;
		assert.deepEqual(tail, {changes: [], nextCursor: page2.nextCursor, hasMore: false});
		const upgraded = (await s.feed(start)).body;
		assert.equal(upgraded.changes.filter((c: any) => c.entityId === id).length, 3);
	} finally {
		await s.app.close();
	}
});

test('measurements are created, corrected and tombstoned with revision checks in the feed', async () => {
	const s = await env();
	try {
		const id = 'body-weight-' + randomUUID();
		const create = await s.send([put(id, null)]).expect(201);
		assert.equal(create.body.results[0].status, 'accepted');
		assert.equal(create.body.results[0].revision, 1);
		const edit = await s.send([put(id, 1, {kg: 82.5, date: '2020-02-28T21:00:00'})]).expect(201);
		assert.equal(edit.body.results[0].status, 'accepted');
		const stale = await s.send([put(id, 1, {kg: 70})]).expect(201);
		assert.equal(stale.body.results[0].status, 'conflict');
		const recreate = await s.send([put(id, null)]).expect(201);
		assert.equal(recreate.body.results[0].status, 'conflict');
		const remove = await s.send([put(id, 2, {kg: 82.5, date: '2020-02-28T21:00:00', deleted: true})]).expect(201);
		assert.equal(remove.body.results[0].revision, 3);
		const restore = await s.send([put(id, 3, {kg: 82.5, date: '2020-02-28T21:00:00'})]).expect(201);
		assert.equal(restore.body.results[0].revision, 4);
		const feed = await s.feed();
		const changes = feed.body.changes.filter((c: any) => c.entityId === id);
		assert.deepEqual(
			changes.map((c: any) => [c.kind, c.revision, c.payload.kg, c.payload.deleted]),
			[
				['putBodyWeight', 1, 80.25, false],
				['putBodyWeight', 2, 82.5, false],
				['putBodyWeight', 3, 82.5, true],
				['putBodyWeight', 4, 82.5, false],
			],
		);
	} finally {
		await s.app.close();
	}
});

test('invalid measurements and cross-kind writes are refused without touching workouts', async () => {
	const s = await env();
	try {
		const id = 'body-weight-' + randomUUID();
		const invalid = [
			put(id, null, {kg: 0}),
			put(id, null, {kg: -1}),
			put(id, null, {kg: 80.255}),
			put(id, null, {kg: 501}),
			put(id, null, {date: ''}),
			put(id, null, {date: '2020-02-30T09:15:00'}),
			put(id, null, {date: '2020-02-29T09:15:00Z'}),
			put(id, null, {extra: true}),
			{...put(id, null), payload: workout(id)},
			{...put(id, null), payload: measurement('other')},
			{...put(id, null), kind: 'putWorkout'},
			{...put(id, null), kind: 'putFutureThing'},
		];
		const r = await s.send(invalid).expect(201);
		assert.deepEqual(
			r.body.results.map((a: any) => a.status),
			invalid.map(() => 'rejected'),
		);
		// A measurement cannot overwrite a workout record, nor a workout a measurement.
		const workoutId = 'w-' + randomUUID();
		const native = {
			operationId: randomUUID(),
			entityId: workoutId,
			kind: 'putWorkout',
			expectedRevision: null,
			payload: workout(workoutId),
		};
		await s.send([native]).expect(201);
		const overwrite = await s.send([put(native.entityId, 1)]).expect(201);
		assert.notEqual(overwrite.body.results[0].status, 'accepted');
		await s.send([put(id, null)]).expect(201);
		const asWorkout = await s
			.send([
				{
					operationId: randomUUID(),
					entityId: id,
					kind: 'putTemplate',
					expectedRevision: 1,
					payload: workout(id),
				},
			])
			.expect(201);
		assert.notEqual(asWorkout.body.results[0].status, 'accepted');
		const feed = await s.feed();
		assert.deepEqual(feed.body.changes.find((c: any) => c.entityId === native.entityId).payload, native.payload);
		assert.equal(feed.body.changes.filter((c: any) => c.entityId === id).length, 1);
	} finally {
		await s.app.close();
	}
});
