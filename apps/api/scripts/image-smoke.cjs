'use strict';

// Runs once while the image is built (Dockerfile): a failure fails the build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = '/app/server';
const requireFromServer = require('node:module').createRequire(path.join(server, 'package.json'));
const manifest = require(path.join(server, 'package.json'));

const devDependencies = Object.keys(manifest.devDependencies ?? {});
assert.ok(devDependencies.length > 0, 'package.json lists no devDependencies to check');
const resolvable = devDependencies.filter((name) => {
	try {
		requireFromServer.resolve(`${name}/package.json`);
		return true;
	} catch {
		return fs.existsSync(path.join(server, 'node_modules', name));
	}
});
assert.deepEqual(resolvable, [], `Development dependencies in the image: ${resolvable.join(', ')}`);

// Env files are host configuration and never belong in the image.
const envFiles = [];
const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
		const file = path.join(dir, entry.name);
		if (/^\.env(?:\.|$)|^\.postgres\.env$/.test(entry.name)) envFiles.push(file);
		if (entry.isDirectory() && !entry.isSymbolicLink()) walk(file);
	}
};
walk('/app');
assert.deepEqual(envFiles, [], `Env files in the image: ${envFiles.join(', ')}`);

for (const file of [
	'/app/web/index.html',
	'/app/web/sw.js',
	'/app/web/manifest.webmanifest',
	`${server}/dist/trial.js`,
])
	assert.ok(fs.statSync(file).isFile(), `Missing from the image: ${file}`);

// Loading these needs every runtime dependency the server imports, without starting it.
for (const dependency of Object.keys(manifest.dependencies)) requireFromServer(dependency);
requireFromServer(`${server}/dist/app.js`);
const migrations = requireFromServer(`${server}/dist/db/database.js`).database(
	'postgres://synthetic@ember-postgres:5432/ember_smoke',
).options.migrations;
assert.ok(Array.isArray(migrations) && migrations.length > 0, 'The image has no migrations');

console.log(
	`Image smoke check passed: ${devDependencies.length} dev dependencies absent, ${migrations.length} migrations.`,
);
