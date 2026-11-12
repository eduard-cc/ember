import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

function runMigration(url?: string) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('EMBER_') && !key.startsWith('DOTENV_')),
	);
	env.DOTENV_CONFIG_PATH = '/dev/null';
	if (url !== undefined) env.EMBER_DATABASE_URL = url;
	// Replace only the database adapter; execute the actual command entry point.
	// An invalid endpoint must not even construct an adapter, let alone initialize/network.
	const source = `const target=require.resolve('./src/db/database.ts');
 require.cache[target]={id:target,filename:target,loaded:true,exports:{database(){console.log('DATABASE_CONSTRUCTED');return {async initialize(){console.log('DATABASE_INITIALIZED');return this;},async runMigrations(){console.log('MIGRATIONS_RUN');},async destroy(){console.log('DATABASE_DESTROYED');}};}}};
 require('./src/migrate.ts');`;
	return spawnSync(process.execPath, ['--import', 'tsx', '-e', source], {env, encoding: 'utf8'});
}
test('migration command refuses non-isolated endpoints before touching the database adapter', async (t) => {
	for (const [label, url] of [
		['missing', undefined],
		['malformed', 'not-a-url'],
		['external host', 'postgresql://synthetic@external.invalid:55439/ember'],
		['wrong port', 'postgresql://synthetic@127.0.0.1:5432/ember'],
		['missing port', 'postgresql://synthetic@127.0.0.1/ember'],
		['unrelated database', 'postgresql://synthetic@127.0.0.1:55439/unrelated'],
		['invalid suffix', 'postgresql://synthetic@127.0.0.1:55439/ember-foreign'],
		['wrong protocol', 'http://127.0.0.1:55439/ember'],
		...[
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
		].map((suffix) => [suffix, 'postgresql://synthetic@127.0.0.1:55439/ember_test_review' + suffix] as const),
	] as const)
		await t.test(label, () => {
			const result = runMigration(url);
			assert.equal(result.status, 1, 'migration must exit unsuccessfully');
			assert.equal(result.stdout, '', 'invalid endpoint must not construct or initialize the adapter');
			assert.match(result.stderr, /Ember migration failed/);
		});
});
function runMigrationWithInterceptedPg(url: string) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith('EMBER_') && !key.startsWith('DOTENV_') && !key.startsWith('PG'),
		),
	);
	env.DOTENV_CONFIG_PATH = '/dev/null';
	env.EMBER_DATABASE_URL = url;
	// Keep the real TypeORM adapter and installed pg URL parser. Stop at the
	// client's connection boundary, before pg can create a socket or resolve DNS.
	const source = `require('node:net').Socket.prototype.connect=function(){throw new Error('NETWORK_FORBIDDEN');};
 const pg=require('pg');
 const RealPool=pg.Pool;
 pg.Pool=class extends RealPool {constructor(options){super(options);console.log('PG_POOL_CONSTRUCTED');}};
 pg.Client.prototype.connect=function(callback){
  const {host,port,database}=this.connectionParameters;
  console.log(JSON.stringify({host,port,database}));
  callback(new Error('SYNTHETIC_CONNECTION_INTERCEPTED'));
 };
 require('./src/migrate.ts');`;
	return spawnSync(process.execPath, ['--import', 'tsx', '-e', source], {env, encoding: 'utf8', timeout: 60000});
}
test('real migration adapter reaches only the isolated parsed endpoint for a plain URL', () => {
	const result = runMigrationWithInterceptedPg('postgresql://synthetic@127.0.0.1:55439/ember_test_review');
	assert.equal(result.status, 1);
	assert.equal(
		result.stdout,
		'PG_POOL_CONSTRUCTED\n' +
			JSON.stringify({host: '127.0.0.1', port: 55439, database: 'ember_test_review'}) +
			'\n',
	);
	assert.equal(result.stderr, 'Ember migration failed\n');
});
test('real migration adapter rejects query overrides before constructing a pg pool', async (t) => {
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
	])
		await t.test(suffix, () => {
			const result = runMigrationWithInterceptedPg(
				'postgresql://synthetic@127.0.0.1:55439/ember_test_review' + suffix,
			);
			assert.equal(result.status, 1);
			assert.equal(result.stdout, '', 'invalid URL must not reach the installed pg adapter');
			assert.equal(result.stderr, 'Ember migration failed\n');
		});
});
test('migration command accepts isolated PostgreSQL endpoints without application authentication config', () => {
	for (const url of [
		'postgresql://synthetic@127.0.0.1:55439/ember',
		'postgres://synthetic@127.0.0.1:55439/ember_test_isolation',
	]) {
		const result = runMigration(url);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			result.stdout,
			'DATABASE_CONSTRUCTED\nDATABASE_INITIALIZED\nMIGRATIONS_RUN\nEmber migrations applied\nDATABASE_DESTROYED\n',
		);
		assert.equal(result.stderr, '');
	}
});
