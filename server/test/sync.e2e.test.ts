import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

import {database} from '../src/db/database';
import {origin, setup} from './helpers';

export const workout = (id: string) => ({
	id,
	name: 'Synthetic',
	date: '2026-01-01T10:00:00',
	duration: 30,
	exercises: [
		{
			name: 'Press',
			type: 'weighted',
			sets: [
				{
					id: 'source-row-1',
					weight: 0,
					reps: 5,
					seconds: null,
					distance: null,
					completed: true,
					original: {Weight: '0', RPE: ''},
				},
			],
		},
	],
});
const op = (kind = 'putWorkout') => {
	const id = 'source-' + randomUUID();
	return {operationId: randomUUID(), entityId: id, kind, expectedRevision: null, payload: workout(id)};
};
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
	};
}
test('creates completed workout and returns it in ordered feed', async () => {
	const s = await env();
	try {
		const operation = op();
		const r = await s.send([operation]).expect(201);
		assert.equal(r.body.results[0].status, 'accepted');
		assert.equal(r.body.results[0].revision, 1);
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + (r.body.results[0].changeSeq - 1) + '&limit=100')
			.set('Cookie', s.cookie)
			.expect(200);
		const change = feed.body.changes.find((c: any) => c.entityId === operation.entityId);
		assert.deepEqual(change.payload, operation.payload);
		assert.equal(change.changeSeq, r.body.results[0].changeSeq);
		// Phones download the whole feed on a fresh installation: pages travel compressed.
		await s.send(Array.from({length: 20}, () => op())).expect(201);
		const page = await s.http
			.get('/api/v1/sync/changes?after=0&limit=100')
			.set('Cookie', s.cookie)
			.set('Accept-Encoding', 'gzip')
			.expect(200);
		assert.equal(page.headers['content-encoding'], 'gzip');
		assert.equal(page.headers['cache-control'], 'no-store');
		assert.equal(page.body.changes.length, 21);
	} finally {
		await s.app.close();
	}
});
test('operation replay returns original acknowledgement regardless of key order', async () => {
	const s = await env();
	try {
		const operation = op();
		const first = await s.send([operation]).expect(201);
		const reordered = {
			payload: operation.payload,
			expectedRevision: null,
			kind: operation.kind,
			entityId: operation.entityId,
			operationId: operation.operationId,
		};
		const replay = await s.send([reordered]).expect(201);
		assert.deepEqual(replay.body, first.body);
	} finally {
		await s.app.close();
	}
});
test('same operation ID with altered validated payload conflicts without changing data', async () => {
	const s = await env();
	try {
		const o = op();
		await s.send([o]).expect(201);
		o.payload.name = 'Different';
		const r = await s.send([o]).expect(201);
		assert.equal(r.body.results[0].status, 'conflict');
		assert.equal(r.body.results[0].errorCode, 'OPERATION_ID_REUSED');
	} finally {
		await s.app.close();
	}
});
test('concurrent stale template edits yield one winner and preserve revision', async () => {
	const s = await env();
	try {
		const initial = op('putTemplate');
		await s.send([initial]).expect(201);
		const edit = (name: string) => ({
			...initial,
			operationId: randomUUID(),
			expectedRevision: 1,
			payload: {...initial.payload, name},
		});
		const responses = await Promise.all([s.send([edit('A')]), s.send([edit('B')])]);
		const acks = responses.map((r) => r.body.results[0]);
		assert.deepEqual(acks.map((a) => a.status).sort(), ['accepted', 'conflict']);
		assert.equal(acks.find((a) => a.status === 'accepted').revision, 2);
		const duplicate = {...initial, operationId: randomUUID()};
		const rejected = await s.send([duplicate]);
		assert.equal(rejected.body.results[0].status, 'conflict');
	} finally {
		await s.app.close();
	}
});
test('delete template emits revisioned tombstone and never deletes workout', async () => {
	const s = await env();
	try {
		const template = op('putTemplate');
		await s.send([template]);
		const remove = {
			operationId: randomUUID(),
			entityId: template.entityId,
			kind: 'deleteTemplate',
			expectedRevision: 1,
			payload: null,
		};
		const r = await s.send([remove]).expect(201);
		assert.equal(r.body.results[0].status, 'accepted');
		assert.equal(r.body.results[0].revision, 2);
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + (r.body.results[0].changeSeq - 1))
			.set('Cookie', s.cookie);
		assert.equal(feed.body.changes[0].payload, null);
		assert.equal(feed.body.changes[0].kind, 'deleteTemplate');
		const w = op();
		await s.send([w]);
		const bad = await s.send([{...remove, operationId: randomUUID(), entityId: w.entityId}]);
		assert.equal(bad.body.results[0].status, 'conflict');
		const resurrect = await s.send([{...template, operationId: randomUUID(), expectedRevision: 2}]);
		assert.equal(resurrect.body.results[0].status, 'conflict');
	} finally {
		await s.app.close();
	}
});
test('invalid operations are rejected independently without syncing drafts or mismatched identities', async () => {
	const s = await env();
	try {
		const valid = op();
		const draft = op();
		draft.payload.exercises[0].sets[0].completed = false;
		const badId = op();
		badId.payload.id = 'other';
		const update = op();
		update.expectedRevision = 1 as any;
		const missing = op();
		missing.payload = null as any;
		const r = await s.send([draft, badId, missing, valid, update]).expect(201);
		assert.deepEqual(
			r.body.results.map((a: any) => a.status),
			['rejected', 'rejected', 'rejected', 'accepted', 'conflict'],
		);
		const unknown = await s.send([{...op(), ownerId: 'attacker'}]).expect(201);
		assert.equal(unknown.body.results[0].status, 'rejected');
	} finally {
		await s.app.close();
	}
});
test('workouts and templates can never revise each other', async () => {
	const s = await env();
	try {
		const initial = op('putTemplate');
		await s.send([initial]);
		const wrong = {...initial, operationId: randomUUID(), kind: 'putWorkout', expectedRevision: 1};
		const r = await s.send([wrong]).expect(201);
		assert.equal(r.body.results[0].status, 'conflict');
		const native = op();
		await s.send([native]);
		const asTemplate = await s.send([
			{...native, operationId: randomUUID(), kind: 'putTemplate', expectedRevision: 1},
		]);
		assert.equal(asTemplate.body.results[0].status, 'conflict');
	} finally {
		await s.app.close();
	}
});
test('finished workout accepts exclusion flags and owner edits at the expected revision', async () => {
	const s = await env();
	try {
		const native = op();
		await s.send([native]).expect(201);
		const flag = (excluded: boolean, revision: number) => {
			const payload = structuredClone(native.payload) as any;
			if (excluded) payload.exercises[0].sets[0].excluded = true;
			return {...native, operationId: randomUUID(), expectedRevision: revision, payload};
		};
		const exclude = await s.send([flag(true, 1)]).expect(201);
		assert.equal(exclude.body.results[0].status, 'accepted');
		assert.equal(exclude.body.results[0].revision, 2);
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + (exclude.body.results[0].changeSeq - 1))
			.set('Cookie', s.cookie)
			.expect(200);
		assert.equal(feed.body.changes[0].kind, 'putWorkout');
		assert.equal(feed.body.changes[0].payload.exercises[0].sets[0].excluded, true);
		const stale = await s.send([flag(false, 1)]).expect(201);
		assert.equal(stale.body.results[0].status, 'conflict');
		const include = await s.send([flag(false, 2)]).expect(201);
		assert.equal(include.body.results[0].status, 'accepted');
		// Owner edits from History: values, name, date, duration and added sets.
		let revision = 3;
		for (const change of [
			(p: any) => (p.exercises[0].sets[0].reps = 6),
			(p: any) => (p.name = 'Renamed'),
			(p: any) => ((p.date = '2026-01-02T08:30:00'), (p.duration = 55)),
			(p: any) => p.exercises[0].sets.push({...p.exercises[0].sets[0], id: 'extra'}),
		]) {
			const edit = flag(false, revision);
			change(edit.payload);
			const r = await s.send([edit]).expect(201);
			assert.equal(r.body.results[0].status, 'accepted');
			assert.equal(r.body.results[0].revision, ++revision);
		}
		const staleEdit = flag(false, 3);
		staleEdit.payload.name = 'Lost update';
		assert.equal((await s.send([staleEdit]).expect(201)).body.results[0].status, 'conflict');
		// An edit can never turn history back into a draft or an empty workout.
		const draft = flag(false, revision);
		draft.payload.exercises[0].sets[0].completed = false;
		const empty = flag(false, revision);
		empty.payload.exercises = [];
		const invalid = await s.send([draft, empty]).expect(201);
		assert.deepEqual(
			invalid.body.results.map((a: any) => a.status),
			['rejected', 'rejected'],
		);
	} finally {
		await s.app.close();
	}
});
test('imported workout accepts exclusion flags and owner edits at the expected revision', async () => {
	const s = await env();
	try {
		const imported = op('putImportedWorkout');
		await s.send([imported]).expect(201);
		const update = (revision: number, change: (p: any) => void) => {
			const payload = structuredClone(imported.payload) as any;
			change(payload);
			return {...imported, operationId: randomUUID(), expectedRevision: revision, payload};
		};
		const exclude = await s.send([update(1, (p) => (p.exercises[0].sets[0].excluded = true))]).expect(201);
		assert.equal(exclude.body.results[0].status, 'accepted');
		assert.equal(exclude.body.results[0].revision, 2);
		const include = await s.send([update(2, () => undefined)]).expect(201);
		assert.equal(include.body.results[0].status, 'accepted');
		const edit = await s.send([update(3, (p) => (p.exercises[0].sets[0].reps = 9))]).expect(201);
		assert.equal(edit.body.results[0].status, 'accepted');
		assert.equal(edit.body.results[0].revision, 4);
		const stale = await s.send([update(3, () => undefined)]).expect(201);
		assert.equal(stale.body.results[0].status, 'conflict');
		// Native and imported kinds stay separate: neither may revise the other.
		const crossed = await s.send([{...update(4, () => undefined), kind: 'putWorkout'}]).expect(201);
		assert.equal(crossed.body.results[0].status, 'conflict');
	} finally {
		await s.app.close();
	}
});
test('deleted native workout leaves a tombstone only opted-in clients receive', async () => {
	const s = await env();
	try {
		const page = (after: number, limit: number, optIn: boolean) => {
			const request = s.http
				.get('/api/v1/sync/changes?after=' + after + '&limit=' + limit)
				.set('Cookie', s.cookie);
			if (optIn) request.set('X-Sync-Workout-Deletes', '1');
			return request.expect(200);
		};
		let start = 0;
		for (;;) {
			const r = (await page(start, 100, true)).body;
			start = r.nextCursor;
			if (!r.hasMore) break;
		}
		const native = op();
		const kept = op();
		await s.send([native, kept]).expect(201);
		const remove = (entityId: string, expectedRevision: number | null) => ({
			operationId: randomUUID(),
			entityId,
			kind: 'deleteWorkout',
			expectedRevision,
			payload: null,
		});
		const template = op('putTemplate');
		const imported = op('putImportedWorkout');
		await s.send([template, imported]).expect(201);
		const refused = await s
			.send([
				remove(native.entityId, null),
				{...remove(native.entityId, 1), payload: native.payload},
				remove(template.entityId, 1),
				remove(imported.entityId, 1),
				remove(native.entityId, 2),
			])
			.expect(201);
		assert.deepEqual(
			refused.body.results.map((a: any) => a.status),
			['rejected', 'rejected', 'conflict', 'conflict', 'conflict'],
		);
		const deleted = await s.send([remove(native.entityId, 1)]).expect(201);
		assert.equal(deleted.body.results[0].status, 'accepted');
		assert.equal(deleted.body.results[0].revision, 2);
		const third = op();
		await s.send([third]).expect(201);
		// The tombstone cannot be resurrected or edited.
		const revive = await s.send([{...native, operationId: randomUUID(), expectedRevision: 2}]).expect(201);
		assert.equal(revive.body.results[0].status, 'conflict');
		// Older apps can't read the new kind: it is filtered out before pagination.
		// Each legacy page must satisfy the old client's checks: known kinds, a cursor at the
		// last returned change, and never an empty page that claims more.
		const legacyKinds = [
			'putWorkout',
			'putTemplate',
			'deleteTemplate',
			'putImportedWorkout',
			'deleteImportedWorkout',
		];
		const readLegacy = async (limit: number, header?: [string, string]) => {
			const seen: any[] = [];
			for (let cursor = start; ;) {
				const request = s.http
					.get('/api/v1/sync/changes?after=' + cursor + '&limit=' + limit)
					.set('Cookie', s.cookie);
				if (header) request.set(...header);
				const r = (await request.expect(200)).body;
				assert.equal(r.nextCursor, r.changes.length ? r.changes.at(-1).changeSeq : cursor);
				assert.ok(!(r.hasMore && r.changes.length === 0));
				assert.ok(r.changes.every((c: any) => legacyKinds.includes(c.kind) || c.kind === 'putBodyWeight'));
				seen.push(...r.changes);
				cursor = r.nextCursor;
				if (!r.hasMore) break;
			}
			return seen;
		};
		for (const limit of [1, 2, 100]) {
			const legacy = await readLegacy(limit);
			assert.ok(legacy.every((c: any) => c.kind !== 'deleteWorkout'));
			assert.ok(legacy.some((c: any) => c.entityId === third.entityId));
		}
		// The body-weight opt-in alone never exposes workout tombstones.
		const bodyWeightOnly = await readLegacy(1, ['X-Sync-Body-Weight', '1']);
		assert.ok(bodyWeightOnly.every((c: any) => c.kind !== 'deleteWorkout'));
		// A tombstone as the newest change: the legacy feed ends at the change before it.
		const last = op();
		await s.send([last]).expect(201);
		const lastDeleted = await s.send([remove(last.entityId, 1)]).expect(201);
		assert.equal(lastDeleted.body.results[0].status, 'accepted');
		const tail = await readLegacy(1);
		assert.equal(tail.at(-1).entityId, last.entityId);
		assert.equal(tail.at(-1).kind, 'putWorkout');
		// Cross-kind revival of a native tombstone is refused, and deletes are not repeatable.
		const crossRevive = await s
			.send([
				{
					...imported,
					operationId: randomUUID(),
					entityId: native.entityId,
					expectedRevision: 2,
					payload: {...imported.payload, id: native.entityId},
				},
				remove(native.entityId, 2),
			])
			.expect(201);
		assert.deepEqual(
			crossRevive.body.results.map((a: any) => a.status),
			['conflict', 'conflict'],
		);
		const upgraded = (await page(start, 100, true)).body.changes;
		const tombstone = upgraded.find((c: any) => c.kind === 'deleteWorkout');
		assert.deepEqual(
			{entityId: tombstone.entityId, revision: tombstone.revision, payload: tombstone.payload},
			{entityId: native.entityId, revision: 2, payload: null},
		);
		assert.ok(upgraded.some((c: any) => c.entityId === kept.entityId && c.kind === 'putWorkout'));
	} finally {
		await s.app.close();
	}
});
test('cursor is strictly bounded and pages preserve order', async () => {
	const s = await env();
	try {
		for (const query of ['after=-1', 'after=1.5', 'after=abc', 'limit=0', 'limit=101', 'after=9007199254740992'])
			await s.http
				.get('/api/v1/sync/changes?' + query)
				.set('Cookie', s.cookie)
				.expect(400);
		const r = await s.send([op(), op(), op()]);
		const cursor = r.body.results[0].changeSeq - 1;
		const first = await s.http
			.get('/api/v1/sync/changes?after=' + cursor + '&limit=2')
			.set('Cookie', s.cookie)
			.expect(200);
		assert.equal(first.body.changes.length, 2);
		assert.equal(first.body.hasMore, true);
		assert.equal(first.body.nextCursor, r.body.results[1].changeSeq);
		const next = await s.http
			.get('/api/v1/sync/changes?after=' + first.body.nextCursor + '&limit=2')
			.set('Cookie', s.cookie);
		assert.equal(next.body.changes.length, 1);
		assert.equal(next.body.hasMore, false);
	} finally {
		await s.app.close();
	}
});
test('database write failure rolls back record sequence and ledger; retry succeeds', async () => {
	const s = await env();
	const db = await database(process.env.EMBER_DATABASE_URL!).initialize();
	const fail = op();
	const first = op();
	try {
		await db.query(
			`CREATE FUNCTION gym_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id='${fail.entityId}' THEN RAISE EXCEPTION 'synthetic write failure'; END IF; RETURN NEW; END $$`,
		);
		await db.query(
			'CREATE TRIGGER gym_test_failure BEFORE INSERT ON changes FOR EACH ROW EXECUTE FUNCTION gym_test_failure()',
		);
		await s.send([first, fail]).expect(500);
		const [r] = await db.query('SELECT count(*)::int AS count FROM records WHERE entity_id=$1', [fail.entityId]);
		assert.equal(r.count, 0);
		const [l] = await db.query('SELECT count(*)::int AS count FROM operation_ledger WHERE operation_id=$1', [
			fail.operationId,
		]);
		assert.equal(l.count, 0);
		await db.query('DROP TRIGGER gym_test_failure ON changes');
		await db.query('DROP FUNCTION gym_test_failure()');
		const retry = await s.send([first, fail]).expect(201);
		assert.equal(retry.body.results[1].changeSeq, retry.body.results[0].changeSeq + 1);
	} finally {
		await db.query('DROP TRIGGER IF EXISTS gym_test_failure ON changes');
		await db.query('DROP FUNCTION IF EXISTS gym_test_failure()');
		await db.destroy();
		await s.app.close();
	}
});
test('delayed first transaction cannot be skipped by a concurrent cursor reader', async () => {
	const s = await env();
	const db = await database(process.env.EMBER_DATABASE_URL!).initialize();
	const slow = op(),
		fast = op();
	try {
		await db.query(
			`CREATE FUNCTION gym_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id='${slow.entityId}' THEN PERFORM pg_sleep(0.4); END IF; RETURN NEW; END $$`,
		);
		await db.query(
			'CREATE TRIGGER gym_test_delay BEFORE INSERT ON changes FOR EACH ROW EXECUTE FUNCTION gym_test_delay()',
		);
		const started = s.send([slow]).then((r) => r);
		// Poll actual PostgreSQL wait state rather than assuming request scheduling.
		let waiting = false;
		for (let n = 0; n < 100; n++) {
			const [r] = await db.query(
				"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep') AS waiting",
			);
			if (r.waiting) {
				waiting = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 5));
		}
		assert.ok(waiting, 'first transaction reached its delayed change insert');
		const concurrent = await s.send([fast]).expect(201);
		const first = await started;
		assert.equal(first.status, 201);
		assert.equal(concurrent.body.results[0].changeSeq, first.body.results[0].changeSeq + 1);
		const feed = await s.http
			.get('/api/v1/sync/changes?after=' + (first.body.results[0].changeSeq - 1) + '&limit=1')
			.set('Cookie', s.cookie)
			.expect(200);
		assert.equal(feed.body.changes[0].entityId, slow.entityId);
		assert.equal(feed.body.hasMore, true);
		const next = await s.http
			.get('/api/v1/sync/changes?after=' + feed.body.nextCursor)
			.set('Cookie', s.cookie)
			.expect(200);
		assert.equal(next.body.changes[0].entityId, fast.entityId);
	} finally {
		await db.query('DROP TRIGGER IF EXISTS gym_test_delay ON changes');
		await db.query('DROP FUNCTION IF EXISTS gym_test_delay()');
		await db.destroy();
		await s.app.close();
	}
});
test('bounded bodies accept document over default Express limit and reject oversized batch', async () => {
	const s = await env();
	try {
		const large = op();
		large.payload.exercises[0].sets[0].original.Weight = 'x'.repeat(200000);
		const r = await s.send([large]).expect(201);
		assert.equal(r.body.results[0].status, 'accepted');
		const over = op();
		over.payload.exercises[0].sets[0].original.Weight = 'x'.repeat(10 * 1024 * 1024);
		await s.send([over]).expect(413);
		await s.send([]).expect(400);
		await s.send(Array.from({length: 51}, () => op())).expect(400);
		await s.http
			.post('/api/v1/sync/operations')
			.set('Origin', origin)
			.set('Cookie', s.cookie)
			.send({version: 1, operations: [op()]})
			.expect(403);
	} finally {
		await s.app.close();
	}
});
