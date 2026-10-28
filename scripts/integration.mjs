import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const {Pool} = require('pg'),
  argon2 = require('argon2'),
  dotenv = require('dotenv');
const root = new URL('../', import.meta.url).pathname;
const config = dotenv.parse(readFileSync(root + 'server/.env'));
const url = new URL(config.EMBER_DATABASE_URL);
if (
  url.href.includes('?') ||
  url.href.includes('#') ||
  url.hostname !== '127.0.0.1' ||
  url.port !== '55439' ||
  url.pathname !== '/ember_dev'
)
  throw Error('Expected the isolated ember_dev admin database, never the live ember database');
const admin = new Pool({connectionString: url.toString()});
const apiPort = process.env.EMBER_TEST_API_PORT ?? '5190';
if (!/^\d+$/.test(apiPort) || Number(apiPort) < 1024 || Number(apiPort) > 65535)
  throw Error('Invalid isolated test API port');
const children = [];
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await exited;
  }
}
async function run(args, env, capture = false) {
  const child = spawn(
    'npx',
    ['playwright', 'test', '--config', 'playwright.integration.config.ts', ...args],
    {cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'},
  );
  let output = '';
  if (capture) child.stdout.on('data', (b) => (output += b.toString()));
  const code = await new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)));
  return {code, output};
}
async function ready(endpoint, child) {
  for (let n = 0; n < 200; n++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Owned service exited');
    try {
      if ((await fetch(endpoint)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Owned service readiness timeout');
}
for (const port of [5188, Number(apiPort)])
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(Error(`Port ${port} is occupied; no existing process will be reused or stopped`)),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
let created = null;
try {
  const build = spawn('npm', ['--prefix', 'server', 'run', 'build'], {cwd: root, stdio: 'inherit'});
  if (await new Promise((r) => build.once('exit', r))) throw Error('API build failed');
  const password = randomBytes(32).toString('hex');
  const env = {
    ...process.env,
    ...config,
    EMBER_OWNER_PASSWORD_HASH: await argon2.hash(password),
    EMBER_ORIGIN: 'http://127.0.0.1:5188',
    EMBER_PORT: apiPort,
    EMBER_TEST_API_PORT: apiPort,
    EMBER_TEST_HARNESS: '1',
    EMBER_AUTH_MODE: 'password',
    EMBER_TAILSCALE_USER_LOGIN: 'ember-browser@example.invalid',
    EMBER_TEST_PASSWORD: password,
    NODE_ENV: 'development',
  };
  delete env.EMBER_CSV;
  const args = process.argv.slice(2);
  const listed = await run([...args, '--list', '--reporter=json'], env, true);
  if (listed.code) throw Error('Could not enumerate integration tests');
  const specs = [];
  function collect(suite) {
    for (const spec of suite.specs ?? []) specs.push(spec);
    for (const child of suite.suites ?? []) collect(child);
  }
  for (const suite of JSON.parse(listed.output).suites) collect(suite);
  if (!specs.length) throw Error('No integration tests selected');
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort'],
    {cwd: root, env, stdio: ['ignore', 'ignore', 'pipe']},
  );
  children.push(vite);
  vite.stderr.on('data', () => {});
  await ready('http://127.0.0.1:5188/', vite);
  let passed = 0;
  for (const [index, spec] of specs.entries()) {
    // One fresh migrated DB and API per vertical scenario; production login throttling stays enabled.
    const name = `ember_browser_test_${process.pid}_${index}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    created = name;
    url.pathname = '/' + name;
    const api = spawn(process.execPath, ['dist/main.js'], {
      cwd: root + 'server',
      env: {
        ...env,
        EMBER_DATABASE_URL: url.toString(),
        EMBER_AUTH_MODE: spec.file.endsWith('automatic.spec.ts') ? 'tailscale' : 'password',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    children.push(api);
    api.stderr.on('data', () => {});
    try {
      await ready(`http://127.0.0.1:${apiPort}/api/v1/health`, api);
      const title = spec.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const result = await run([...args, spec.file, '--grep', title + '$'], {
        ...env,
        EMBER_TEST_DATABASE_URL: url.toString(),
      });
      if (result.code) process.exitCode = 1;
      else passed++;
    } finally {
      await stop(api);
      children.splice(children.indexOf(api), 1);
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      created = null;
    }
  }
  console.log(`Real PostgreSQL/API browser scenarios: ${passed}/${specs.length} passed`);
} finally {
  for (const child of children.reverse()) await stop(child);
  if (created) await admin.query(`DROP DATABASE IF EXISTS "${created}" WITH (FORCE)`);
  await admin.end();
}
