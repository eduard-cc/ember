import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

import {database} from '../src/db/database';
import {resetDataset} from '../src/sync/reset';
import {SyncService} from '../src/sync/service';
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
			sets: [{id: id + ':row-1', weight: 0, reps: 5, seconds: null, distance: null, original: {Weight: '0'}}],
		},
	],
});

const op = (kind = 'putWorkout') => {
	const id = 'source-' + randomUUID();
	return {operationId: randomUUID(), entityId: id, kind, expectedRevision: null, payload: workout(id)};
};

test('a dataset reset purges history, seeds imports and fences stale clients by epoch', async () => {
	const s = await setup();
	const db = await database(process.env.EMBER_DATABASE_URL!).initialize();
	try {
		const send = (operations: unknown[], epoch?: string) => {
			const req = s.http
				.post('/api/v1/sync/operations')
				.set('Origin', origin)
				.set('Cookie', s.cookie)
				.set('X-CSRF-Token', s.csrf);
			if (epoch) req.set('X-Dataset-Epoch', epoch);
			return req.send({version: 1, operations});
		};
		const before = await s.http.get('/api/v1/session').set('Cookie', s.cookie).expect(200);
		assert.equal(before.body.epoch, 'initial');
		// Clients that predate epochs keep working until the first reset.
		await send([op(), op('putTemplate')]).expect(201);

		const seeded = workout('import:seed:0');
		const result = await resetDataset(db, 'owner', [seeded]);
		assert.match(result.epoch, /^[0-9a-f-]{36}$/);
		assert.equal(result.imported, 1);

		const session = await s.http.get('/api/v1/session').set('Cookie', s.cookie).expect(200);
		assert.equal(session.body.epoch, result.epoch);
		// A stale or pre-epoch client can neither push nor pull.
		const stale = await send([op()]).expect(409);
		assert.equal(stale.body.errorCode, 'DATASET_RESET');
		await send([op()], 'initial').expect(409);
		await s.http.get('/api/v1/sync/changes?after=0').set('Cookie', s.cookie).expect(409);

		const feed = await s.http
			.get('/api/v1/sync/changes?after=0')
			.set('Cookie', s.cookie)
			.set('X-Dataset-Epoch', result.epoch)
			.expect(200);
		assert.deepEqual(
			feed.body.changes.map((c: any) => [c.entityId, c.kind, c.revision]),
			[['import:seed:0', 'putImportedWorkout', 1]],
		);
		assert.deepEqual(feed.body.changes[0].payload, seeded);
		const fresh = await send([op()], result.epoch).expect(201);
		assert.equal(fresh.body.results[0].status, 'accepted');
		assert.equal(Number((await db.query("SELECT count(*) FROM records WHERE owner_id='owner'"))[0].count), 2);
	} finally {
		await db.destroy();
		await s.app.close();
	}
});

for (const method of ['operations', 'changes'] as const) {
	test(`a reset between authentication and ${method} is fenced under the owner lock`, async () => {
		const s = await setup();
		const db = await database(process.env.EMBER_DATABASE_URL!).initialize();
		const before = await s.http.get('/api/v1/session').set('Cookie', s.cookie).expect(200);
		const original = SyncService.prototype[method];
		// Deterministic barrier after any controller checks but before the service starts.
		(SyncService.prototype as any)[method] = async function (...args: any[]) {
			await resetDataset(db, 'owner', [workout('import:race:0')]);
			return (original as any).apply(this, args);
		};
		try {
			const request =
				method === 'operations'
					? s.http
							.post('/api/v1/sync/operations')
							.set('Origin', origin)
							.set('X-CSRF-Token', s.csrf)
							.send({version: 1, operations: [op()]})
					: s.http.get('/api/v1/sync/changes?after=0');
			const response = await request
				.set('Cookie', s.cookie)
				.set('X-Dataset-Epoch', before.body.epoch)
				.expect(409);
			assert.equal(response.body.errorCode, 'DATASET_RESET');
			const rows = await db.query("SELECT entity_id FROM records WHERE owner_id='owner'");
			assert.deepEqual(
				rows.map((r: any) => r.entity_id),
				['import:race:0'],
			);
		} finally {
			(SyncService.prototype as any)[method] = original;
			await db.destroy();
			await s.app.close();
		}
	});
}

test('a reset refuses invalid seed documents and leaves history untouched', async () => {
	const s = await setup();
	const db = await database(process.env.EMBER_DATABASE_URL!).initialize();
	try {
		const before = await db.query('SELECT count(*) FROM records');
		const broken = {...workout('import:bad:0'), date: 'not a date'};
		await assert.rejects(resetDataset(db, 'owner', [broken as any]));
		assert.deepEqual(await db.query('SELECT count(*) FROM records'), before);
	} finally {
		await db.destroy();
		await s.app.close();
	}
});
