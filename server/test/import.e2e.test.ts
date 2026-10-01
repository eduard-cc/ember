import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

import {origin, setup} from './helpers';

const workout = (id: string) => ({
	id,
	name: 'Same name',
	date: '2026-01-01T10:00:00',
	duration: 0,
	exercises: [
		{
			name: 'Press',
			type: 'weighted',
			sets: [
				{
					id: 'row-1',
					weight: null,
					reps: 0,
					seconds: null,
					distance: null,
					original: {Weight: '', Reps: '0', Notes: 'raw;\nvalue'},
				},
			],
		},
	],
});
test('explicit imported record creates and revisioned removal preserve native history', async () => {
	const s = await setup();
	try {
		const send = (operations: any[]) =>
			s.http
				.post('/api/v1/sync/operations')
				.set('Origin', origin)
				.set('Cookie', s.cookie)
				.set('X-CSRF-Token', s.csrf)
				.send({version: 1, operations});
		const importedId = 'import-' + randomUUID(),
			nativeId = 'native-' + randomUUID();
		const imported = {
			operationId: randomUUID(),
			entityId: importedId,
			kind: 'putImportedWorkout',
			expectedRevision: null,
			payload: workout(importedId),
		};
		const native = {
			...imported,
			operationId: randomUUID(),
			entityId: nativeId,
			kind: 'putWorkout',
			payload: workout(nativeId),
		};
		const result = await send([imported, native]).expect(201);
		assert.deepEqual(
			result.body.results.map((a: any) => a.status),
			['accepted', 'accepted'],
		);
		const cursor = result.body.results[0].changeSeq - 1;
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + cursor)
			.set('Cookie', s.cookie)
			.expect(200);
		assert.deepEqual(feed.body.changes[0].payload, imported.payload);
		const remove = (id: string, revision = 1) => ({
			operationId: randomUUID(),
			entityId: id,
			kind: 'deleteImportedWorkout',
			expectedRevision: revision,
			payload: null,
		});
		const removal = await send([remove(nativeId), remove(importedId, 2), remove(importedId)]).expect(201);
		assert.deepEqual(
			removal.body.results.map((a: any) => a.status),
			['conflict', 'conflict', 'accepted'],
		);
		const after = await s.http
			.get('/api/v1/sync/changes?after=' + result.body.results[1].changeSeq)
			.set('Cookie', s.cookie)
			.expect(200);
		assert.equal(after.body.changes.length, 1);
		assert.equal(after.body.changes[0].kind, 'deleteImportedWorkout');
		const revival = {...imported, operationId: randomUUID(), expectedRevision: 2};
		const resurrection = await send([revival]).expect(201);
		assert.equal(resurrection.body.results[0].status, 'accepted');
		assert.equal(resurrection.body.results[0].revision, 3);
		const replay = await send([revival]).expect(201);
		assert.deepEqual(replay.body, resurrection.body);
		const denied = await send([
			{...imported, operationId: randomUUID(), expectedRevision: 2},
			{...imported, operationId: randomUUID(), expectedRevision: 3},
			{
				...imported,
				operationId: randomUUID(),
				entityId: nativeId,
				expectedRevision: 1,
				payload: workout(nativeId),
			},
		]).expect(201);
		assert.deepEqual(
			denied.body.results.map((a: any) => a.status),
			['conflict', 'conflict', 'conflict'],
		);
		const revivedFeed = await s.http
			.get('/api/v1/sync/changes?after=' + result.body.results[1].changeSeq)
			.set('Cookie', s.cookie)
			.expect(200);
		assert.deepEqual(
			revivedFeed.body.changes.map((a: any) => [a.kind, a.revision]),
			[
				['deleteImportedWorkout', 2],
				['putImportedWorkout', 3],
			],
		);
		assert.deepEqual(revivedFeed.body.changes[1].payload, imported.payload);
	} finally {
		await s.app.close();
	}
});
test('supported legacy editable template with an empty date synchronizes without timestamp invention', async () => {
	const s = await setup();
	try {
		const id = 'legacy-template-' + randomUUID();
		const payload = {...workout(id), date: ''};
		const r = await s.http
			.post('/api/v1/sync/operations')
			.set('Origin', origin)
			.set('Cookie', s.cookie)
			.set('X-CSRF-Token', s.csrf)
			.send({
				version: 1,
				operations: [
					{operationId: randomUUID(), entityId: id, kind: 'putTemplate', expectedRevision: null, payload},
				],
			})
			.expect(201);
		assert.equal(r.body.results[0].status, 'accepted');
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + (r.body.results[0].changeSeq - 1))
			.set('Cookie', s.cookie);
		assert.deepEqual(feed.body.changes[0].payload, payload);
	} finally {
		await s.app.close();
	}
});
