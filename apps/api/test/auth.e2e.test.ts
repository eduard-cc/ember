import assert from 'node:assert/strict';
import {test} from 'node:test';
import request from 'supertest';

import {createApp} from '../src/app';
import {origin, setup} from './helpers';

test('password mode cannot be bypassed with a Tailscale identity header', async () => {
	const {app, http, password} = await setup();
	try {
		await http
			.post('/api/v1/session')
			.set('Origin', origin)
			.set('Tailscale-User-Login', 'owner@example.test')
			.send({})
			.expect(401);
		await http
			.post('/api/v1/session')
			.set('Origin', origin)
			.set('Tailscale-User-Login', 'other@example.test')
			.send({password})
			.expect(201);
	} finally {
		await app.close();
	}
});

test('unauthenticated sync is 401 on real HTTP', async () => {
	const app = await createApp();
	await app.listen(0, '127.0.0.1');
	try {
		await request(app.getHttpServer()).get('/api/v1/sync/changes').expect(401);
	} finally {
		await app.close();
	}
});
test('provisioned owner logs in through migrated PostgreSQL session', async () => {
	const {app, http, cookie, csrf} = await setup();
	try {
		assert.ok(csrf);
		const result = await http.get('/api/v1/session').set('Cookie', cookie).expect(200);
		assert.equal(result.body.ownerId, 'owner');
		assert.equal(result.body.csrfToken, csrf);
		await http.get('/api/v1/health').expect(200, {status: 'ready'});
	} finally {
		await app.close();
	}
});
test('mutations enforce exact origin before credentials', async () => {
	const {app, http, password} = await setup();
	try {
		await http.post('/api/v1/session').set('Origin', 'https://evil.invalid').send({password}).expect(403);
		await http.post('/api/v1/session').send({password}).expect(403);
	} finally {
		await app.close();
	}
});
test('logout requires CSRF and revokes the PostgreSQL session', async () => {
	const {app, http, cookie, csrf} = await setup();
	try {
		await http.delete('/api/v1/session').set('Origin', origin).set('Cookie', cookie).expect(403);
		await http
			.delete('/api/v1/session')
			.set('Origin', origin)
			.set('Cookie', cookie)
			.set('X-CSRF-Token', csrf)
			.expect(200);
		await http.get('/api/v1/session').set('Cookie', cookie).expect(401);
	} finally {
		await app.close();
	}
});
test('database expiry makes the session unauthorized', async () => {
	process.env.EMBER_SESSION_TTL_SECONDS = '1';
	const {app, http, cookie} = await setup();
	process.env.EMBER_SESSION_TTL_SECONDS = '86400';
	try {
		await new Promise((r) => setTimeout(r, 1100));
		await http.get('/api/v1/session').set('Cookie', cookie).expect(401);
	} finally {
		await app.close();
	}
});
test('login attempts are bounded and errors generic', async () => {
	const {app, http} = await setup();
	try {
		for (let n = 0; n < 4; n++)
			await http.post('/api/v1/session').set('Origin', origin).send({password: 'synthetic-wrong'}).expect(401);
		await http.post('/api/v1/session').set('Origin', origin).send({password: 'synthetic-wrong'}).expect(429);
	} finally {
		await app.close();
	}
});
