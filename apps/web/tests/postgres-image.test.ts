import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

// ops/compose.local.yml pins the PostgreSQL image once, by tag and digest. The backup scripts,
// the image smoke test and CI read it through ops/postgres-image.sh, and the backup scripts
// refuse a container whose image digest is not the pinned one.
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(repo, path), 'utf8');
const composePin = () => {
  const images = [...read('ops/compose.local.yml').matchAll(/^ {4}image: (\S+)$/gm)];
  expect(images).toHaveLength(1);
  const [pin] = images.map((m) => m[1]);
  return {pin, tag: pin.split('@')[0], digest: pin.split('@')[1]};
};
const bash = (script: string, env: Record<string, string> = {}) =>
  spawnSync('bash', ['-c', script], {cwd: repo, encoding: 'utf8', env: {...process.env, ...env}});

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, {recursive: true, force: true});
});

// A docker stand-in on PATH that describes one healthy ember-postgres container on the
// development port and accepts every docker exec, so the backup scripts never reach a daemon.
function fakeDocker(container: {image: string; repoDigest: string}) {
  const dir = mkdtempSync(join(tmpdir(), 'ember-postgres-pin-'));
  scratch.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const id = `sha256:${'1'.repeat(64)}`;
  writeFileSync(
    join(bin, 'docker'),
    `#!/usr/bin/env bash
case "$1 $2" in
'inspect --format') echo '${id} ${container.image} healthy 127.0.0.1:55439' ;;
'image inspect') [[ \${*: -1} == '${id}' ]] && echo '${container.repoDigest}' ;;
exec*) if [[ $* == *'FROM pg_database'* ]]; then echo 0; fi ;;
*) exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  const archives = join(dir, 'archives');
  mkdirSync(archives, {mode: 0o700});
  return {env: {PATH: `${bin}:${process.env.PATH}`}, archive: join(archives, 'synthetic.dump')};
}

describe('PostgreSQL image pin', () => {
  it('is one tag-and-digest pin in the compose file that every reader resolves', () => {
    const {pin} = composePin();
    expect(pin).toMatch(/^postgres:17\.\d+-bookworm@sha256:[0-9a-f]{64}$/);

    const helper = bash('source ops/postgres-image.sh && printf %s "$POSTGRES_IMAGE"');
    expect(helper.stderr).toBe('');
    expect(helper.stdout).toBe(pin);

    for (const path of [
      'ops/backup.sh',
      'ops/restore-check.sh',
      'ops/image-smoke.sh',
      '.github/workflows/ci.yml',
    ]) {
      const source = read(path);
      expect(source, path).toMatch(/^\s*source .*postgres-image\.sh"?$/m);
      expect(source, path).toMatch(/postgres_container_pinned|"\$POSTGRES_IMAGE"/);
      expect(source.match(/\bpostgres:\d+\.\d+/g), path).toBeNull();
    }
  });

  it('lets the backup scripts use a container whose image has the pinned digest', () => {
    const {pin, tag, digest} = composePin();
    // Created from the compose file (tag and digest) or from the tag alone.
    for (const image of [pin, tag]) {
      const {env, archive} = fakeDocker({image, repoDigest: `postgres@${digest}`});

      const backup = bash(`bash ops/backup.sh ember_backup_test_1 '${archive}'`, env);
      expect(backup.stderr, image).toBe('');
      expect(backup.stdout, image).toBe(
        'Local PostgreSQL archive validated (sessions excluded).\n',
      );

      const restore = bash(
        `bash ops/restore-check.sh '${archive}' ember_restore_validation_1`,
        env,
      );
      expect(restore.stderr, image).toBe('');
      expect(restore.status, image).toBe(0);
    }
  });

  it('refuses a container running the pinned tag with another digest', () => {
    const {tag} = composePin();
    const {env, archive} = fakeDocker({
      image: tag,
      repoDigest: `postgres@sha256:${'2'.repeat(64)}`,
    });
    writeFileSync(archive, 'synthetic');

    for (const script of [
      `bash ops/backup.sh ember_backup_test_1 '${archive}.new'`,
      `bash ops/restore-check.sh '${archive}' ember_restore_validation_1`,
    ]) {
      const result = bash(script, env);
      expect(result.status, script).toBe(1);
      expect(result.stderr, script).toBe(
        'Refusing unexpected PostgreSQL container/image/endpoint.\n',
      );
    }
  });
});
