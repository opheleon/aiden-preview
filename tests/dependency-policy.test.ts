import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { parse, stringify } from 'yaml';

const exec = promisify(execFile);
const configuredPolicy = parse(await readFile('pnpm-workspace.yaml', 'utf8'));
const managerVersion = (
  JSON.parse(await readFile('package.json', 'utf8')) as { packageManager: string }
).packageManager;
const cli = process.env.AIDEN_TEST_PNPM_CLI ?? process.env.npm_execpath;

async function registryFixture(name: string, ageDays: number, installScript = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-policy-'));
  const packageDirectory = path.join(root, 'archive', 'package');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      ...(installScript
        ? {
            scripts: {
              install: "node -e \"require('fs').writeFileSync('executed.txt', 'unexpected')\"",
            },
          }
        : {}),
    }),
  );
  const tarball = path.join(root, 'fixture.tgz');
  await exec('tar', ['-czf', tarball, '-C', path.dirname(packageDirectory), 'package']);
  const bytes = await readFile(tarball);
  const server = createServer((request, response) => {
    if (request.url?.endsWith('.tgz')) {
      response.end(bytes);
      return;
    }
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const published = new Date(Date.now() - ageDays * 86_400_000).toISOString();
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        name,
        'dist-tags': { latest: '1.0.0' },
        time: { created: published, modified: published, '1.0.0': published },
        versions: {
          '1.0.0': {
            name,
            version: '1.0.0',
            dist: {
              tarball: `http://127.0.0.1:${address.port}/${name}.tgz`,
              integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
            },
          },
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(
    path.join(project, 'package.json'),
    JSON.stringify({
      private: true,
      packageManager: managerVersion,
      dependencies: { [name]: '1.0.0' },
    }),
  );
  // Use the actual repository policy. Only workspace paths and the fixture registry differ.
  await writeFile(
    path.join(project, 'pnpm-workspace.yaml'),
    stringify({ ...configuredPolicy, packages: [] }),
  );
  await writeFile(
    path.join(project, '.npmrc'),
    `registry=http://127.0.0.1:${address.port}/\nstore-dir=${path.join(root, 'store')}\n`,
  );
  const emptyConfig = path.join(root, 'empty.npmrc');
  await writeFile(emptyConfig, '');
  const env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    npm_config_userconfig: emptyConfig,
    npm_config_globalconfig: emptyConfig,
    CI: 'true',
  };
  return {
    project,
    async install(...args: string[]) {
      return cli?.includes('pnpm')
        ? exec(process.execPath, [cli, 'install', ...args], { cwd: project, env, timeout: 60_000 })
        : exec('pnpm', ['install', ...args], { cwd: project, env, timeout: 60_000 });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

void test('pnpm rejects a release younger than the configured fourteen-day cooldown', async () => {
  const f = await registryFixture('aiden-policy-young-fixture', 1);
  try {
    await assert.rejects(f.install('--no-frozen-lockfile'), (error) => {
      assert.match(
        String(error) + String((error as { stdout?: string }).stdout ?? ''),
        /release age|minimumReleaseAge|NO_MATCHING_VERSION|too young|cooldown/i,
      );
      return true;
    });
  } finally {
    await f.close();
  }
});

void test('pnpm fails unapproved install scripts without executing them', async () => {
  const f = await registryFixture('aiden-policy-script-fixture', 30, true);
  try {
    await assert.rejects(f.install('--no-frozen-lockfile'), (error) => {
      assert.match(
        String(error) + String((error as { stdout?: string }).stdout ?? ''),
        /build|script/i,
      );
      return true;
    });
    await assert.rejects(
      readFile(path.join(f.project, 'node_modules', 'aiden-policy-script-fixture', 'executed.txt')),
      { code: 'ENOENT' },
    );
  } finally {
    await f.close();
  }
});

void test('pnpm installs a mature fixture and rejects frozen lockfile drift', async () => {
  const f = await registryFixture('aiden-policy-lock-fixture', 30);
  try {
    await f.install('--no-frozen-lockfile');
    await f.install('--frozen-lockfile');
    const file = path.join(f.project, 'package.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.dependencies['aiden-policy-lock-fixture'] = '2.0.0';
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(f.install('--frozen-lockfile'), (error) => {
      assert.match(
        String(error) + String((error as { stdout?: string }).stdout ?? ''),
        /OUTDATED_LOCKFILE|frozen.lockfile|not up to date/i,
      );
      return true;
    });
  } finally {
    await f.close();
  }
});
