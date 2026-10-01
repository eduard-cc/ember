import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import request from 'supertest';

import {createApp} from '../src/app';
import './bootstrap';

const owner = 'owner@example.test';
const origin = 'http://127.0.0.1:5188';
async function setup(secure = false) {
	Object.assign(process.env, {
		GYM_LOG_AUTH_MODE: 'tailscale',
		GYM_LOG_TAILSCALE_USER_LOGIN: owner,
		GYM_LOG_HOST: '127.0.0.1',
		GYM_LOG_PORT: '5190',
		GYM_LOG_ORIGIN: secure ? 'https://gym.synthetic.ts.net' : origin,
		GYM_LOG_SESSION_SECURE: String(secure),
		GYM_LOG_SESSION_TTL_SECONDS: '86400',
	});
	delete process.env.GYM_LOG_OWNER_PASSWORD_HASH;
	const app = await createApp();
	await app.listen(0, '127.0.0.1');
	return {app, http: request(app.getHttpServer())};
}

test('Tailscale sync retains exact Origin and CSRF checks and logout revocation', async () => {
	const {app, http} = await setup();
	try {
		const bootstrap = () => http.post('/api/v1/session').set('Tailscale-User-Login', owner).send({});
		await bootstrap().expect(403);
		await bootstrap()
			.set('Origin', origin + '/')
			.expect(403);
		const login = await bootstrap().set('Origin', origin).expect(201);
		const cookie = login.headers['set-cookie'][0].split(';')[0];
		const mutation = (method: 'post' | 'delete', path: string) =>
			http[method](path).set('Cookie', cookie).set('Tailscale-User-Login', owner);
		for (const path of ['/api/v1/session', '/api/v1/sync/operations']) {
			const method = path.endsWith('session') ? 'delete' : 'post';
			await mutation(method, path).set('X-CSRF-Token', login.body.csrfToken).expect(403);
			await mutation(method, path)
				.set('Origin', 'https://evil.example.test')
				.set('X-CSRF-Token', login.body.csrfToken)
				.expect(403);
			await mutation(method, path).set('Origin', origin).expect(403);
			await mutation(method, path).set('Origin', origin).set('X-CSRF-Token', 'wrong').expect(403);
		}
		const id = 'synthetic-' + randomUUID();
		const payload = {id, name: 'Synthetic template', date: '', duration: 0, exercises: []};
		const operation = {
			operationId: randomUUID(),
			entityId: id,
			kind: 'putTemplate',
			expectedRevision: null,
			payload,
		};
		const accepted = await mutation('post', '/api/v1/sync/operations')
			.set('Origin', origin)
			.set('X-CSRF-Token', login.body.csrfToken)
			.send({version: 1, operations: [operation]})
			.expect(201);
		assert.equal(accepted.body.results[0].status, 'accepted');
		const feed = await http
			.get('/api/v1/sync/changes?after=0&limit=100')
			.set('Cookie', cookie)
			.set('Tailscale-User-Login', owner)
			.expect(200);
		assert.deepEqual(feed.body.changes.find((c: {entityId: string}) => c.entityId === id).payload, payload);
		await mutation('delete', '/api/v1/session')
			.set('Origin', origin)
			.set('X-CSRF-Token', login.body.csrfToken)
			.expect(200, {loggedOut: true});
		await http.get('/api/v1/session').set('Cookie', cookie).set('Tailscale-User-Login', owner).expect(401);
		await http.get('/api/v1/session').set('Tailscale-User-Login', owner).expect(401);
	} finally {
		await app.close();
	}
});

test('cookies cannot bypass owner identity on any session or sync operation', async () => {
	const {app, http} = await setup();
	try {
		const login = await http
			.post('/api/v1/session')
			.set('Origin', origin)
			.set('Tailscale-User-Login', owner)
			.send({})
			.expect(201);
		const cookie = login.headers['set-cookie'][0].split(';')[0];
		for (const identity of [undefined, 'other@example.test', 'Owner@example.test', owner + ', ' + owner]) {
			for (const [method, path] of [
				['get', '/api/v1/session'],
				['get', '/api/v1/sync/changes?after=0&limit=100'],
				['post', '/api/v1/sync/operations'],
				['delete', '/api/v1/session'],
			] as const) {
				const req = http[method](path)
					.set('Cookie', cookie)
					.set('Origin', origin)
					.set('X-CSRF-Token', login.body.csrfToken);
				if (identity !== undefined) req.set('Tailscale-User-Login', identity);
				if (method === 'post') req.send({version: 1, operations: []});
				await req.expect(401);
			}
		}
		await http.get('/api/v1/session').set('Cookie', cookie).set('Tailscale-User-Login', owner).expect(200);
	} finally {
		await app.close();
	}
});

test('missing or other Tailscale identities cannot bootstrap', async () => {
	const {app, http} = await setup();
	try {
		for (const identity of [
			undefined,
			'other@example.test',
			'Owner@example.test',
			owner + ', other@example.test',
		]) {
			const req = http.post('/api/v1/session').set('Origin', origin).send({});
			if (identity !== undefined) req.set('Tailscale-User-Login', identity);
			const result = await req.expect(401);
			assert.equal(result.headers['set-cookie'], undefined);
		}
	} finally {
		await app.close();
	}
});

test('configured Tailscale owner bootstraps without a password and reuses a database session', async () => {
	const {app, http} = await setup(true);
	try {
		const login = await http
			.post('/api/v1/session')
			.set('Origin', 'https://gym.synthetic.ts.net')
			.set('Tailscale-User-Login', owner)
			.send({})
			.expect(201);
		assert.equal(login.body.ownerId, 'owner');
		assert.match(login.body.csrfToken, /^[a-f0-9]{64}$/);
		const rawCookie = login.headers['set-cookie'][0];
		assert.match(rawCookie, /HttpOnly/);
		assert.match(rawCookie, /Secure/);
		assert.match(rawCookie, /SameSite=Strict/);
		assert.match(rawCookie, /Path=\/api\/v1/);
		const cookie = rawCookie.split(';')[0];
		assert.match(cookie, /^gym_log_session=[a-f0-9]{64}$/);
		const current = await http
			.get('/api/v1/session')
			.set('Cookie', cookie)
			.set('Tailscale-User-Login', owner)
			.expect(200);
		assert.deepEqual(current.body, login.body);
		await http
			.get('/api/v1/sync/changes?after=0&limit=100')
			.set('Cookie', cookie)
			.set('Tailscale-User-Login', owner)
			.expect(200);
		const fresh = await http
			.post('/api/v1/session')
			.set('Origin', 'https://gym.synthetic.ts.net')
			.set('Tailscale-User-Login', owner)
			.set('Cookie', cookie)
			.send({})
			.expect(201);
		assert.notEqual(fresh.headers['set-cookie'][0].split(';')[0], cookie);
		assert.notEqual(fresh.body.csrfToken, login.body.csrfToken);
	} finally {
		await app.close();
	}
});
