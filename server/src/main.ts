import {createApp} from './app';
import {config} from './config';

async function main() {
	const cfg = config();
	const app = await createApp();
	const shutdown = async () => {
		await app.close();
		process.exit(0);
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
	await app.listen(cfg.port, cfg.host);
	console.log(`Gym Log API listening on ${cfg.host}:${cfg.port}`);
}
main().catch(() => {
	console.error('Gym Log API startup failed (check local configuration and database)');
	process.exitCode = 1;
});
