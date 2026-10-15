import type {NextFunction, Request, Response} from 'express';
import {realpath, stat} from 'node:fs/promises';
import {isAbsolute, join, resolve, sep} from 'node:path';

import {createApp} from './app';
import {config} from './config';
import {isServedShellFile} from './static-files';

async function main() {
	// tsc emits server/dist/trial.js; two levels up is the repository root.
	const configuredRoot = process.env.GYM_LOG_WEB_ROOT ?? resolve(__dirname, '../../dist');
	if (!isAbsolute(configuredRoot)) throw new Error('GYM_LOG_WEB_ROOT must be absolute');
	const root = await realpath(configuredRoot);
	for (const file of ['index.html', 'manifest.webmanifest']) {
		const target = await realpath(join(root, file));
		if (!target.startsWith(root + sep) || !(await stat(target)).isFile())
			throw new Error('Incomplete production web root');
	}
	const cfg = config();
	const app = await createApp();
	// Only built shell files are public. Never serve a repository directory or
	// fall back to index.html for API, private, or unknown client paths.
	app.use(async (req: Request, res: Response, next: NextFunction) => {
		if (!['GET', 'HEAD'].includes(req.method)) {
			next();
			return;
		}
		let path: string;
		try {
			path = decodeURIComponent(req.path);
		} catch {
			next();
			return;
		}
		const file = path === '/' ? 'index.html' : path.slice(1);
		if (!isServedShellFile(file)) {
			next();
			return;
		}
		try {
			const target = await realpath(join(root, file));
			if (target !== join(root, file) || !target.startsWith(root + sep)) {
				next();
				return;
			}
			res.sendFile(target, {dotfiles: 'allow'}, (error) => {
				if (error) next(error);
			});
		} catch {
			next();
		}
	});
	const shutdown = async () => {
		await app.close();
		process.exit(0);
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
	try {
		await app.listen(cfg.port, cfg.host);
	} catch (error) {
		await app.close();
		throw error;
	}
	console.log(`Gym Log trial listening on ${cfg.host}:${cfg.port}`);
}
main().catch(() => {
	console.error('Gym Log trial startup failed (check production web root, local configuration and database)');
	process.exitCode = 1;
});
