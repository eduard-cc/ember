import * as argon2 from 'argon2';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {test} from 'node:test';

import './bootstrap';

test('compiled API binds loopback and serves auth, replay and readiness over TCP', async () => {
	const password = randomBytes(32).toString('hex');
	const child = spawn(process.execPath, ['dist/main.js'], {
		env: {...process.env, GYM_LOG_OWNER_PASSWORD_HASH: await argon2.hash(password)},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout.on('data', (b) => {
		output += b.toString();
	});
	const exited = once(child, 'exit');
	try {
		for (let n = 0; n < 200 && !output.includes('listening'); n++) {
			if (child.exitCode !== null) throw new Error('API process exited during startup');
			await new Promise((r) => setTimeout(r, 10));
		}
		assert.match(output, /127\.0\.0\.1:5190/);
		const url = 'http://127.0.0.1:5190/api/v1';
		const origin = process.env.GYM_LOG_ORIGIN!;
		const health = await fetch(url + '/health');
		assert.equal(health.status, 200);
		assert.equal(health.headers.get('cache-control'), 'no-store');
		const login = await fetch(url + '/session', {
			method: 'POST',
			headers: {Origin: origin, 'Content-Type': 'application/json'},
			body: JSON.stringify({password}),
		});
		assert.equal(login.status, 201);
		const cookie = login.headers.get('set-cookie')!.split(';')[0];
		const session = (await login.json()) as any;
		assert.equal(session.ownerId, 'owner');
		const id = 'smoke-' + randomUUID();
		const operation = {
			operationId: randomUUID(),
			entityId: id,
			kind: 'putTemplate',
			expectedRevision: null,
			payload: {id, name: 'Synthetic process test', date: '2026-01-01', duration: 0, exercises: []},
		};
		const send = () =>
			fetch(url + '/sync/operations', {
				method: 'POST',
				headers: {
					Origin: origin,
					Cookie: cookie,
					'X-CSRF-Token': session.csrfToken,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({version: 1, operations: [operation]}),
			});
		const first = await send();
		assert.equal(first.status, 201);
		const result = await first.json();
		assert.deepEqual(await (await send()).json(), result);
		assert.equal((await fetch(url + '/sync/changes', {headers: {Cookie: cookie}})).status, 200);
	} finally {
		child.kill('SIGTERM');
		await exited;
	}
});
