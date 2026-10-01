import 'dotenv/config';
import {z} from 'zod';

export function validateDatabaseUrl(url: string) {
	const db = new URL(url);
	// pg interprets URL query parameters as connection options, including host
	// and port overrides. This isolated-endpoint contract permits neither query
	// nor fragment delimiters (including empty ones).
	if (
		db.href.includes('?') ||
		db.href.includes('#') ||
		!['postgres:', 'postgresql:'].includes(db.protocol) ||
		db.hostname !== '127.0.0.1' ||
		db.port !== '55439' ||
		!/^\/gym_log(?:_[a-z0-9_]+)?$/.test(db.pathname)
	)
		throw new Error('This local API requires the isolated Gym Log PostgreSQL endpoint');
	return url;
}
export function config() {
	const e = z
		.object({
			GYM_LOG_HOST: z.literal('127.0.0.1'),
			GYM_LOG_PORT: z.coerce.number().int().min(1024).max(65535),
			GYM_LOG_ORIGIN: z.url(),
			GYM_LOG_DATABASE_URL: z.url(),
			GYM_LOG_AUTH_MODE: z.enum(['password', 'tailscale']).default('password'),
			GYM_LOG_TAILSCALE_USER_LOGIN: z.string().optional(),
			GYM_LOG_OWNER_PASSWORD_HASH: z.string().optional(),
			GYM_LOG_SESSION_SECURE: z.enum(['true', 'false']),
			GYM_LOG_SESSION_TTL_SECONDS: z.coerce.number().int().min(1).max(2592000),
		})
		.parse(process.env);
	validateDatabaseUrl(e.GYM_LOG_DATABASE_URL);
	if (e.GYM_LOG_AUTH_MODE === 'password') {
		z.string().startsWith('$argon2id$').parse(e.GYM_LOG_OWNER_PASSWORD_HASH);
	} else {
		z.string()
			.min(1)
			.refine((login) => login.trim() === login)
			.parse(e.GYM_LOG_TAILSCALE_USER_LOGIN);
	}
	const origin = new URL(e.GYM_LOG_ORIGIN);
	if (
		origin.origin !== e.GYM_LOG_ORIGIN ||
		(e.GYM_LOG_SESSION_SECURE === 'false' &&
			(origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)))
	)
		throw new Error('Insecure sessions require explicit loopback HTTP origin');
	if (e.GYM_LOG_AUTH_MODE === 'tailscale') {
		const localDev = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
		if (
			!localDev &&
			!(
				origin.protocol === 'https:' &&
				origin.hostname.endsWith('.ts.net') &&
				e.GYM_LOG_SESSION_SECURE === 'true'
			)
		)
			throw new Error(
				'Tailscale authentication requires secure HTTPS .ts.net origin or loopback HTTP development origin',
			);
	}
	return {
		host: e.GYM_LOG_HOST,
		port: e.GYM_LOG_PORT,
		origin: e.GYM_LOG_ORIGIN,
		url: e.GYM_LOG_DATABASE_URL,
		authMode: e.GYM_LOG_AUTH_MODE,
		tailscaleUserLogin: e.GYM_LOG_TAILSCALE_USER_LOGIN,
		hash: e.GYM_LOG_OWNER_PASSWORD_HASH,
		secure: e.GYM_LOG_SESSION_SECURE === 'true',
		ttl: e.GYM_LOG_SESSION_TTL_SECONDS,
	};
}
export type Config = ReturnType<typeof config>;
