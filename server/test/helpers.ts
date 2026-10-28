import * as argon2 from 'argon2';
import {randomBytes} from 'node:crypto';
import request from 'supertest';

import {createApp} from '../src/app';
import './bootstrap';

export const origin = 'http://127.0.0.1:5188';
export async function setup() {
	const password = randomBytes(32).toString('hex');
	process.env.EMBER_OWNER_PASSWORD_HASH = await argon2.hash(password);
	const app = await createApp();
	await app.listen(0, '127.0.0.1');
	const http = request(app.getHttpServer());
	const login = await http.post('/api/v1/session').set('Origin', origin).send({password}).expect(201);
	const cookie = login.headers['set-cookie'][0].split(';')[0];
	return {app, http, cookie, csrf: login.body.csrfToken, password};
}
