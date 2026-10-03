import 'dotenv/config';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

import {database} from '../src/db/database';
import {SyncService} from '../src/sync/service';

function run(script: string, ...args: string[]) {
	return spawnSync('bash', [resolve('../ops', script), ...args], {encoding: 'utf8', env: process.env});
}
test('isolated pg_dump archive restores logical documents and ledger into a fresh validation database', async () => {
	const url = new URL(process.env.GYM_LOG_DATABASE_URL!);
	assert.equal(url.hostname, '127.0.0.1');
	assert.equal(url.port, '55439');
	assert.equal(url.pathname, '/gym_log_dev', 'tests never run against the live gym_log database');
	const adminUrl = new URL(url);
	adminUrl.pathname = '/postgres';
	const admin = await database(adminUrl.toString()).initialize();
	const sourceName = `gym_log_backup_test_${process.pid}`;
	const targetName = `gym_log_restore_validation_${process.pid}`;
	const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'gym-backup-'));
	const dump = join(dir, 'synthetic.dump');
	let source: ReturnType<typeof database> | undefined;
	let restored: ReturnType<typeof database> | undefined;
	let sourceCreated = false;
	let targetCreated = false;
	try {
		await admin.query(`CREATE DATABASE ${sourceName}`);
		sourceCreated = true;
		url.pathname = '/' + sourceName;
		source = await database(url.toString()).initialize();
		await source.runMigrations();
		const id = 'synthetic-source:001';
		const payload = {
			id,
			name: 'Synthetic',
			date: '2026-01-01T10:00:00',
			duration: 0,
			exercises: [
				{
					name: 'B',
					type: 'weighted',
					sets: [
						{
							id: 'row:001',
							weight: 0,
							reps: 5,
							seconds: null,
							distance: null,
							completed: true,
							original: {Weight: '0', RPE: ''},
						},
					],
				},
				{name: 'A', type: 'bodyweight', sets: []},
			],
		};
		const service = new SyncService(source);
		const result = await service.operations('synthetic-owner', {
			version: 1,
			operations: [
				{operationId: randomUUID(), entityId: id, kind: 'putWorkout', expectedRevision: null, payload},
			],
		});
		assert.equal(result.results[0].status, 'accepted');
		const templateId = 'synthetic-template:001';
		const template = {...payload, id: templateId, name: 'Synthetic template'};
		const templateResult = await service.operations('synthetic-owner', {
			version: 1,
			operations: [
				{
					operationId: randomUUID(),
					entityId: templateId,
					kind: 'putTemplate',
					expectedRevision: null,
					payload: template,
				},
			],
		});
		assert.equal(templateResult.results[0].status, 'accepted');
		const editResult = await service.operations('synthetic-owner', {
			version: 1,
			operations: [
				{
					operationId: randomUUID(),
					entityId: templateId,
					kind: 'putTemplate',
					expectedRevision: 1,
					payload: {...template, name: 'Edited synthetic template'},
				},
			],
		});
		assert.equal(editResult.results[0].revision, 2);
		await source.query(
			"INSERT INTO sessions VALUES ('synthetic-session-hash','synthetic-owner','synthetic-csrf',now()+interval '1 hour')",
		);
		const exported = run('backup.sh', sourceName, dump);
		assert.equal(exported.status, 0, exported.stderr);
		assert.notEqual(run('backup.sh', sourceName, dump).status, 0, 'existing archive must not be overwritten');
		assert.equal(statSync(dump).mode & 0o777, 0o600);
		const restoredResult = run('restore-check.sh', dump, targetName);
		assert.equal(restoredResult.status, 0, restoredResult.stderr);
		targetCreated = true;
		url.pathname = '/' + targetName;
		restored = await database(url.toString()).initialize();
		for (const table of ['records', 'changes', 'owner_sequences', 'operation_ledger', 'migrations'])
			assert.deepEqual(
				await restored.query(`SELECT * FROM ${table} ORDER BY 1,2`),
				await source.query(`SELECT * FROM ${table} ORDER BY 1,2`),
			);
		assert.deepEqual(
			(await restored.query('SELECT payload FROM records WHERE entity_id=$1', [id]))[0].payload,
			payload,
		);
		assert.equal((await restored.query('SELECT count(*)::int AS count FROM sessions'))[0].count, 0);
		assert.notEqual(
			run('restore-check.sh', dump, targetName).status,
			0,
			'even a valid archive cannot replace an existing validation database',
		);
		const before = await restored.query('SELECT * FROM records');
		const bad = join(dir, 'bad.dump');
		writeFileSync(bad, 'not a PostgreSQL archive', {mode: 0o600});
		const freshBadTarget = `gym_log_restore_validation_${process.pid}0`;
		assert.notEqual(run('restore-check.sh', bad, freshBadTarget).status, 0);
		assert.equal(
			(await admin.query('SELECT count(*)::int AS count FROM pg_database WHERE datname=$1', [freshBadTarget]))[0]
				.count,
			0,
		);
		assert.notEqual(run('restore-check.sh', bad, targetName).status, 0);
		assert.deepEqual(await restored.query('SELECT * FROM records'), before);
		assert.notEqual(run('restore-check.sh', dump, 'gym_log').status, 0);
		assert.notEqual(run('backup.sh', 'unrelated', join(dir, 'unsafe.dump')).status, 0);
	} finally {
		await restored?.destroy();
		await source?.destroy();
		// Only test-created names; never drop default or other application databases.
		if (targetCreated) await admin.query(`DROP DATABASE ${targetName}`);
		if (sourceCreated) await admin.query(`DROP DATABASE ${sourceName}`);
		await admin.destroy();
		rmSync(dir, {recursive: true, force: true});
	}
});
