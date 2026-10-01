import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';

const args = process.argv.slice(2);
const files = args.length
	? args
	: readdirSync('test')
			.filter((f) => f.endsWith('.e2e.test.ts'))
			.map((f) => 'test/' + f);
if (!files.length) throw new Error('No integration test files found');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
	stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
