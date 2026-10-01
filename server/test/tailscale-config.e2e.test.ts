import assert from 'node:assert/strict';
import {test} from 'node:test';

import {config} from '../src/config';

function configured(run: () => void) {
	const values = {
		GYM_LOG_HOST: '127.0.0.1',
		GYM_LOG_PORT: '5190',
		GYM_LOG_ORIGIN: 'http://127.0.0.1:5188',
		GYM_LOG_DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55439/gym_log_test_auth',
		GYM_LOG_AUTH_MODE: 'tailscale',
		GYM_LOG_TAILSCALE_USER_LOGIN: 'owner@example.test',
		GYM_LOG_SESSION_SECURE: 'false',
		GYM_LOG_SESSION_TTL_SECONDS: '60',
		GYM_LOG_OWNER_PASSWORD_HASH: undefined,
	};
	const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	try {
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		run();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('tailscale remote origins require secure HTTPS on a .ts.net hostname', () =>
	configured(() => {
		for (const [origin, secure] of [
			['https://gym.synthetic.ts.net', 'true'],
			['http://127.0.0.1:5188', 'false'],
			['http://localhost:5188', 'false'],
		] as const) {
			process.env.GYM_LOG_ORIGIN = origin;
			process.env.GYM_LOG_SESSION_SECURE = secure;
			assert.equal(config().origin, origin);
		}
		for (const [origin, secure] of [
			['https://gym.example.test', 'true'],
			['http://gym.synthetic.ts.net', 'true'],
			['https://gym.synthetic.ts.net', 'false'],
			['https://gym.synthetic.ts.net.evil.test', 'true'],
			['https://ts.net', 'true'],
			['http://127.0.0.1:5188/', 'false'],
		] as const) {
			process.env.GYM_LOG_ORIGIN = origin;
			process.env.GYM_LOG_SESSION_SECURE = secure;
			assert.throws(() => config(), origin);
		}
	}));

test('password remains the default and requires its hash', () =>
	configured(() => {
		delete process.env.GYM_LOG_AUTH_MODE;
		assert.throws(() => config());
		process.env.GYM_LOG_OWNER_PASSWORD_HASH = '$argon2id$synthetic';
		assert.equal(config().authMode, 'password');
		process.env.GYM_LOG_AUTH_MODE = 'unknown';
		assert.throws(() => config());
	}));

test('tailscale startup requires an exact configured owner but no password hash', () =>
	configured(() => {
		const cfg = config();
		assert.equal(cfg.authMode, 'tailscale');
		assert.equal(cfg.tailscaleUserLogin, 'owner@example.test');
		for (const login of [undefined, '', ' owner@example.test', 'owner@example.test ']) {
			if (login === undefined) delete process.env.GYM_LOG_TAILSCALE_USER_LOGIN;
			else process.env.GYM_LOG_TAILSCALE_USER_LOGIN = login;
			assert.throws(() => config());
		}
	}));
