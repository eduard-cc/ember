import 'dotenv/config';
import {after, before} from 'node:test';

import {database} from '../src/db/database';

const original = process.env.GYM_LOG_DATABASE_URL!;
const name = `gym_log_test_${process.pid}`;
before(async () => {
	const url = new URL(original);
	if (
		url.href.includes('?') ||
		url.href.includes('#') ||
		url.hostname !== '127.0.0.1' ||
		url.port !== '55439' ||
		url.pathname !== '/gym_log_dev'
	)
		throw new Error('Integration tests require the gym_log_dev database, never the live gym_log database');
	const admin = await database(original).initialize();
	try {
		await admin.query(`CREATE DATABASE "${name}"`);
	} finally {
		await admin.destroy();
	}
	url.pathname = '/' + name;
	process.env.GYM_LOG_DATABASE_URL = url.toString();
});
after(async () => {
	process.env.GYM_LOG_DATABASE_URL = original;
	const admin = await database(original).initialize();
	try {
		await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	} finally {
		await admin.destroy();
	}
});
