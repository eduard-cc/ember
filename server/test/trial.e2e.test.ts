import * as argon2 from 'argon2';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

import './bootstrap';

async function freePort() {
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const port = address.port;
	await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
	return port;
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'gym-log-trial-'));
	await mkdir(join(root, 'assets'));
	await mkdir(join(root, 'icons'));
	await writeFile(
		join(root, 'index.html'),
		'<!doctype html><title>Synthetic trial shell</title><script src="/assets/index-synthetic.js"></script>',
	);
	await writeFile(join(root, 'manifest.webmanifest'), JSON.stringify({name: 'Synthetic trial', start_url: '/'}));
	await writeFile(join(root, 'sw.js'), '// Synthetic service worker');
	await writeFile(join(root, 'assets/index-synthetic.js'), 'console.log("Synthetic shell");');
	await writeFile(join(root, 'icons/icon-192.png'), 'synthetic icon bytes');
	await writeFile(join(root, 'assets/drawing-synthetic-0-Ab_12-cd.webp'), 'synthetic drawing bytes');
	await mkdir(join(root, 'src'));
	await mkdir(join(root, 'server'));
	await writeFile(join(root, 'src/main.ts'), '// Synthetic private source');
	await writeFile(join(root, 'server/.env'), 'SYNTHETIC_ONLY=true');
	await writeFile(join(root, 'private-export.csv'), 'Synthetic private export');
	await writeFile(join(root, 'assets/private-export.csv'), 'Synthetic private export');
	await symlink(join(root, 'private-export.csv'), join(root, 'assets/outside.js'));
	return root;
}
async function start(root: string) {
	const port = await freePort();
	const password = randomBytes(32).toString('hex');
	const child = spawn(process.execPath, [resolve('dist/trial.js')], {
		env: {
			...process.env,
			GYM_LOG_PORT: String(port),
			GYM_LOG_ORIGIN: 'https://synthetic-trial.example',
			GYM_LOG_SESSION_SECURE: 'true',
			GYM_LOG_OWNER_PASSWORD_HASH: await argon2.hash(password),
			GYM_LOG_WEB_ROOT: root,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout.on('data', (b) => {
		output += b.toString();
	});
	child.stderr.on('data', (b) => {
		output += b.toString();
	});
	const exited = once(child, 'exit');
	const stop = async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
		await exited;
	};
	return {child, password, port, exited, stop, output: () => output};
}
async function ready(server: Awaited<ReturnType<typeof start>>) {
	for (let n = 0; n < 500 && !server.output().includes('listening'); n++) {
		if (server.child.exitCode !== null) break;
		await new Promise((r) => setTimeout(r, 10));
	}
	assert.match(
		server.output(),
		new RegExp(`listening on 127\\.0\\.0\\.1:${server.port}`),
		'compiled trial must start its configured listener',
	);
}
test('compiled trial serves the production shell and API on one loopback listener', async () => {
	const root = await fixture();
	const server = await start(root);
	try {
		await ready(server);
		const url = `http://127.0.0.1:${server.port}`;
		const html = await fetch(url + '/');
		assert.equal(html.status, 200);
		assert.match(html.headers.get('content-type')!, /text\/html/);
		assert.match(await html.text(), /Synthetic trial shell/);
		const manifest = await fetch(url + '/manifest.webmanifest');
		assert.equal(manifest.status, 200);
		assert.equal(((await manifest.json()) as any).name, 'Synthetic trial');
		for (const path of [
			'/sw.js',
			'/assets/index-synthetic.js',
			'/assets/drawing-synthetic-0-Ab_12-cd.webp',
			'/icons/icon-192.png',
		])
			assert.equal((await fetch(url + path)).status, 200, path);
		const drawing = await fetch(url + '/assets/drawing-synthetic-0-Ab_12-cd.webp');
		assert.equal(drawing.headers.get('content-type'), 'image/webp');
		const head = await fetch(url + '/sw.js', {method: 'HEAD'});
		assert.equal(head.status, 200);
		assert.equal(await head.text(), '');
		const health = await fetch(url + '/api/v1/health');
		assert.equal(health.status, 200);
		assert.deepEqual(await health.json(), {status: 'ready'});
		assert.equal(health.headers.get('cache-control'), 'no-store');
		assert.equal((await fetch(url + '/api/v1/session')).status, 401);
		const login = await fetch(url + '/api/v1/session', {
			method: 'POST',
			headers: {Origin: 'https://synthetic-trial.example', 'Content-Type': 'application/json'},
			body: JSON.stringify({password: server.password}),
		});
		assert.equal(login.status, 201);
		const cookie = login.headers.get('set-cookie')!;
		assert.match(cookie, /; Secure/);
		assert.match(cookie, /HttpOnly/);
		assert.equal(((await login.json()) as any).ownerId, 'owner');
		const session = await fetch(url + '/api/v1/session', {headers: {Cookie: cookie.split(';')[0]}});
		assert.equal(session.status, 200);
		assert.equal(((await session.json()) as any).ownerId, 'owner');
		for (const path of [
			'/api/v1/missing',
			'/api',
			'/private',
			'/src/main.ts',
			'/server/.env',
			'/private-export.csv',
			'/assets/private-export.csv',
			'/assets/outside.js',
			'/assets/index-synthetic.js.map',
			'/local-csv',
			'/@vite/client',
		])
			assert.equal((await fetch(url + path)).status, 404, path);
	} finally {
		await server.stop();
		await rm(root, {recursive: true, force: true});
	}
});
for (const missing of ['index.html', 'manifest.webmanifest']) {
	test(`compiled trial refuses a web root missing ${missing}`, async () => {
		const root = await fixture();
		await rm(join(root, missing));
		const server = await start(root);
		try {
			const result = await Promise.race([
				server.exited,
				new Promise<null>((done) => setTimeout(() => done(null), 3000)),
			]);
			assert.ok(result, 'incomplete web root must fail startup rather than listen');
			assert.equal(result[0], 1);
			assert.doesNotMatch(server.output(), /listening/);
			assert.match(server.output(), /Gym Log trial startup failed/);
		} finally {
			await server.stop();
			await rm(root, {recursive: true, force: true});
		}
	});
}
