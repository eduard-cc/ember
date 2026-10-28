import 'dotenv/config';

import {validateDatabaseUrl} from './config';
import {database} from './db/database';

async function main() {
	if (!process.env.EMBER_DATABASE_URL) throw new Error('EMBER_DATABASE_URL is required');
	const url = validateDatabaseUrl(process.env.EMBER_DATABASE_URL);
	const db = await database(url).initialize();
	try {
		await db.runMigrations();
		console.log('Ember migrations applied');
	} finally {
		await db.destroy();
	}
}
main().catch(() => {
	console.error('Ember migration failed');
	process.exitCode = 1;
});
