import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {config} from '../src/config';

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
test('startup rejects external or non-PostgreSQL database endpoints', () => {
	const original = process.env.EMBER_DATABASE_URL;
	try {
		for (const url of ['postgresql://synthetic@external.invalid:55439/ember', 'http://127.0.0.1:55439/ember']) {
			process.env.EMBER_DATABASE_URL = url;
			assert.throws(() => config());
		}
	} finally {
		process.env.EMBER_DATABASE_URL = original;
	}
});
