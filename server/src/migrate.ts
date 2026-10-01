import 'dotenv/config';

import {validateDatabaseUrl} from './config';
import {database} from './db/database';

async function main() {
	if (!process.env.GYM_LOG_DATABASE_URL) throw new Error('GYM_LOG_DATABASE_URL is required');
	const url = validateDatabaseUrl(process.env.GYM_LOG_DATABASE_URL);
	const db = await database(url).initialize();
	try {
		await db.runMigrations();
		console.log('Gym Log migrations applied');
	} finally {
		await db.destroy();
	}
}
main().catch(() => {
	console.error('Gym Log migration failed');
	process.exitCode = 1;
});
