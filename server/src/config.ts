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
		!/^\/ember(?:_[a-z0-9_]+)?$/.test(db.pathname)
	)
		throw new Error('This local API requires the isolated Ember PostgreSQL endpoint');
	return url;
}
export function config() {
	const e = z
		.object({
			EMBER_HOST: z.literal('127.0.0.1'),
			EMBER_PORT: z.coerce.number().int().min(1024).max(65535),
			EMBER_ORIGIN: z.url(),
			EMBER_DATABASE_URL: z.url(),
			EMBER_AUTH_MODE: z.enum(['password', 'tailscale']).default('password'),
			EMBER_TAILSCALE_USER_LOGIN: z.string().optional(),
			EMBER_OWNER_PASSWORD_HASH: z.string().optional(),
			EMBER_SESSION_SECURE: z.enum(['true', 'false']),
			EMBER_SESSION_TTL_SECONDS: z.coerce.number().int().min(1).max(2592000),
		})
		.parse(process.env);
	validateDatabaseUrl(e.EMBER_DATABASE_URL);
	if (e.EMBER_AUTH_MODE === 'password') {
		z.string().startsWith('$argon2id$').parse(e.EMBER_OWNER_PASSWORD_HASH);
	} else {
		z.string()
			.min(1)
			.refine((login) => login.trim() === login)
			.parse(e.EMBER_TAILSCALE_USER_LOGIN);
	}
	const origin = new URL(e.EMBER_ORIGIN);
	if (
		origin.origin !== e.EMBER_ORIGIN ||
		(e.EMBER_SESSION_SECURE === 'false' &&
			(origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)))
	)
		throw new Error('Insecure sessions require explicit loopback HTTP origin');
	if (e.EMBER_AUTH_MODE === 'tailscale') {
		const localDev = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
		if (
			!localDev &&
			!(origin.protocol === 'https:' && origin.hostname.endsWith('.ts.net') && e.EMBER_SESSION_SECURE === 'true')
		)
			throw new Error(
				'Tailscale authentication requires secure HTTPS .ts.net origin or loopback HTTP development origin',
			);
	}
	return {
		host: e.EMBER_HOST,
		port: e.EMBER_PORT,
		origin: e.EMBER_ORIGIN,
		url: e.EMBER_DATABASE_URL,
		authMode: e.EMBER_AUTH_MODE,
		tailscaleUserLogin: e.EMBER_TAILSCALE_USER_LOGIN,
		hash: e.EMBER_OWNER_PASSWORD_HASH,
		secure: e.EMBER_SESSION_SECURE === 'true',
		ttl: e.EMBER_SESSION_TTL_SECONDS,
	};
}
export type Config = ReturnType<typeof config>;
