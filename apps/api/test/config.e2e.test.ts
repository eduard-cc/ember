import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {config, validateDatabaseUrl} from '../src/config';

test('startup rejects query overrides and fragments on otherwise isolated database URLs', () => {
	const synthetic = {
		EMBER_HOST: '127.0.0.1',
		EMBER_PORT: '5190',
		EMBER_ORIGIN: 'http://127.0.0.1:5188',
		EMBER_DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55439/ember_test_review',
		EMBER_OWNER_PASSWORD_HASH: '$argon2id$synthetic',
		EMBER_SESSION_SECURE: 'false',
		EMBER_SESSION_TTL_SECONDS: '60',
	};
	const original = Object.fromEntries(Object.keys(synthetic).map((key) => [key, process.env[key]]));
	try {
		Object.assign(process.env, synthetic);
		assert.equal(config().url, synthetic.EMBER_DATABASE_URL);
		for (const suffix of [
			'?host=external.invalid&port=5432',
			'?port=5432',
			'?database=foreign',
			'?%68ost=external.invalid',
			'?%70ort=5432',
			'?%64atabase=foreign',
			'?application_name=synthetic',
			'?',
			'#synthetic',
			'#',
		]) {
			process.env.EMBER_DATABASE_URL = synthetic.EMBER_DATABASE_URL + suffix;
			assert.throws(() => config(), /isolated Ember PostgreSQL endpoint/, suffix);
		}
	} finally {
		for (const [key, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
test('startup accepts only the isolated development and live database endpoints', () => {
	const host = {};
	const container = {EMBER_CONTAINER: '1'};
	const loopback = [
		'postgresql://synthetic@127.0.0.1:55439/ember',
		'postgresql://synthetic@127.0.0.1:55439/ember_dev',
		'postgresql://synthetic@127.0.0.1:55438/ember',
	];
	const inContainer = [
		'postgresql://synthetic@ember-postgres:5432/ember',
		'postgres://synthetic@ember-postgres:5432/ember_smoke',
	];
	for (const url of loopback) assert.equal(validateDatabaseUrl(url, host), url);
	for (const url of inContainer) assert.equal(validateDatabaseUrl(url, container), url);
	// Each mode refuses the other's endpoints, and a mode flag other than exactly 1 is the host.
	for (const [env, url] of [
		...inContainer.map((url) => [host, url] as const),
		...inContainer.map((url) => [{EMBER_CONTAINER: 'true'}, url] as const),
		...loopback.map((url) => [container, url] as const),
	])
		assert.throws(() => validateDatabaseUrl(url, env), /isolated Ember PostgreSQL endpoint/, url);
	for (const url of [
		'postgresql://synthetic@external.invalid:55439/ember',
		'http://127.0.0.1:55439/ember',
		'postgresql://synthetic@127.0.0.1:55438/ember_dev',
		'postgresql://synthetic@127.0.0.1:55438/ember_test_review',
		'postgresql://synthetic@127.0.0.1:55437/ember',
	])
		assert.throws(() => validateDatabaseUrl(url, host), /isolated Ember PostgreSQL endpoint/, url);
	for (const url of [
		'postgresql://synthetic@ember-postgres:55438/ember',
		'postgresql://synthetic@ember-postgres/ember',
		'postgresql://synthetic@ember-postgres:5432/postgres',
		'postgresql://synthetic@ember-postgres:5432/ember-dev',
		'postgresql://synthetic@ember-postgres.invalid:5432/ember',
		'postgresql://synthetic@external.invalid:5432/ember',
		'postgresql://synthetic@ember-postgres:5432/ember?host=external.invalid',
		'http://ember-postgres:5432/ember',
	])
		assert.throws(() => validateDatabaseUrl(url, container), /isolated Ember PostgreSQL endpoint/, url);
});
test('startup binds every interface only inside the container image', () => {
	const synthetic = {
		EMBER_PORT: '5191',
		EMBER_ORIGIN: 'http://127.0.0.1:5191',
		EMBER_OWNER_PASSWORD_HASH: '$argon2id$synthetic',
		EMBER_SESSION_SECURE: 'false',
		EMBER_SESSION_TTL_SECONDS: '60',
	};
	const keys = [...Object.keys(synthetic), 'EMBER_HOST', 'EMBER_DATABASE_URL', 'EMBER_CONTAINER'];
	const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	const start = (env: Record<string, string | undefined>) => {
		for (const key of keys) delete process.env[key];
		Object.assign(process.env, synthetic, env);
		return config();
	};
	const containerDb = 'postgresql://synthetic@ember-postgres:5432/ember_smoke';
	const hostDb = 'postgresql://synthetic@127.0.0.1:55439/ember_dev';
	try {
		assert.equal(
			start({EMBER_CONTAINER: '1', EMBER_HOST: '0.0.0.0', EMBER_DATABASE_URL: containerDb}).host,
			'0.0.0.0',
		);
		assert.equal(start({EMBER_HOST: '127.0.0.1', EMBER_DATABASE_URL: hostDb}).host, '127.0.0.1');
		for (const env of [
			{EMBER_HOST: '0.0.0.0', EMBER_DATABASE_URL: hostDb},
			{EMBER_CONTAINER: '1', EMBER_HOST: '127.0.0.1', EMBER_DATABASE_URL: containerDb},
			{EMBER_CONTAINER: '1', EMBER_HOST: '::', EMBER_DATABASE_URL: containerDb},
		])
			assert.throws(() => start(env), JSON.stringify(env));
	} finally {
		for (const [key, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
