import assert from 'node:assert/strict';
import { mkdir, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { ProjectSchema } from '../packages/contracts/src/index.js';
import { WorkerClient } from '../packages/core/src/client.js';
import {
  discoverRepositories,
  validateProjectRepositories,
} from '../packages/tools/src/discovery.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

async function makeRepo(location: string) {
  await mkdir(location, { recursive: true });
  await g(location, 'init', '-b', 'main');
  await g(location, 'commit', '--allow-empty', '-m', 'Fixture');
}

void test('one root discovers multiple repositories, nested repositories, and stable identities', async () => {
  const f = await fixture();
  const nested = path.join(f.root, 'frontend', 'packages', 'extra');
  await makeRepo(nested);
  const result = await discoverRepositories(f.root);
  assert.equal(result.rootPath, await realpath(f.root));
  assert.deepEqual(
    result.repositories.map((r) => path.basename(r.path)),
    ['backend', 'frontend', 'extra'],
  );
  assert.deepEqual((await discoverRepositories(f.root)).repositories, result.repositories);
  const single = await discoverRepositories(required(f.project.repositories[1]).path);
  assert.equal(single.repositories.length, 1);
  assert.equal(required(single.repositories[0]).path, single.rootPath);
});

void test('discovery stays within root and skips links, hidden folders, dependencies, and Git object stores', async () => {
  const f = await fixture();
  const outside = await fixture();
  await symlink(outside.root, path.join(f.root, 'external'));
  await symlink(f.root, path.join(f.root, 'cycle'));
  await makeRepo(path.join(f.root, 'node_modules', 'dependency'));
  await makeRepo(path.join(f.root, '.hidden', 'repo'));
  await makeRepo(path.join(f.root, 'dist', 'repo'));
  const result = await discoverRepositories(f.root);
  assert.equal(result.repositories.length, 2);
  assert.match(result.warnings.join(' '), /linked folders were skipped/);
  await assert.rejects(
    validateProjectRepositories({ ...f.project, rootPath: outside.root }),
    /inside the selected/,
  );
  await assert.rejects(
    validateProjectRepositories({
      ...f.project,
      rootPath: f.root,
      repositories: [
        {
          ...required(outside.project.repositories[0]),
          path: path.join(f.root, 'external', 'frontend'),
        },
      ],
    }),
    /inside the selected/,
  );
});

void test('empty, uncommitted, unreadable Git metadata, and invalid roots have explicit outcomes', async () => {
  const f = await fixture();
  const empty = path.join(f.root, 'empty');
  await mkdir(empty);
  assert.match((await discoverRepositories(empty)).warnings.join(' '), /No Git repositories/);
  await g(empty, 'init', '-b', 'main');
  assert.match((await discoverRepositories(empty)).warnings.join(' '), /no commits/);
  const broken = path.join(f.root, 'broken');
  await mkdir(broken);
  await writeFile(path.join(broken, '.git'), 'gitdir: missing\n');
  assert.match(
    (await discoverRepositories(f.root)).warnings.join(' '),
    /broken: Git repository could not be read/,
  );
  await assert.rejects(discoverRepositories(path.join(f.root, 'missing')), /unavailable/);
  await assert.rejects(discoverRepositories(path.join(broken, '.git')), /unavailable/);
  await assert.rejects(discoverRepositories('relative'), /absolute/);
});

void test('discovery bounds traversal and reports incomplete coverage', async () => {
  const f = await fixture();
  for (const limits of [
    { maxDepth: 0, maxDirectories: 100, maxRepositories: 100 },
    { maxDepth: 8, maxDirectories: 1, maxRepositories: 100 },
    { maxDepth: 8, maxDirectories: 100, maxRepositories: 1 },
  ]) {
    const result = await discoverRepositories(f.root, limits);
    assert.ok(result.warnings.some((w) => /limited|stopped/.test(w)));
  }
});

void test('worktrees fold into their main checkout, and ordinary subfolders are not repositories', async () => {
  const f = await fixture();
  const worktree = path.join(f.root, 'feature-worktree');
  await g(required(f.project.repositories[0]).path, 'worktree', 'add', '-b', 'feature', worktree);
  const result = await discoverRepositories(f.root);
  assert.deepEqual(
    result.repositories.map((r) => path.basename(r.path)),
    ['backend', 'frontend'],
  );
  assert.ok(result.warnings.some((w) => /feature-worktree is a worktree of frontend/.test(w)));
  // A worktree whose main checkout is outside the folder is kept.
  assert.equal((await discoverRepositories(worktree)).repositories.length, 1);
  const subfolder = path.join(required(f.project.repositories[0]).path, 'src');
  await mkdir(subfolder);
  assert.equal((await discoverRepositories(subfolder)).repositories.length, 0);
});

void test('repositories inside folders a repository ignores are skipped', async () => {
  const f = await fixture();
  const backend = required(f.project.repositories[1]).path;
  await writeFile(path.join(backend, '.gitignore'), 'artifacts/\n');
  await g(backend, 'add', '.gitignore');
  await g(backend, 'commit', '-m', 'Ignore artifacts');
  await makeRepo(path.join(backend, 'artifacts', 'old-checkout'));
  await makeRepo(path.join(backend, 'tools', 'kept'));
  const result = await discoverRepositories(f.root);
  assert.deepEqual(
    result.repositories.map((r) => path.basename(r.path)),
    ['backend', 'frontend', 'kept'],
  );
  assert.ok(result.warnings.some((w) => /Folders a repository ignores/.test(w)));
});

void test('saved projects without root remain compatible; moved repositories are detected on rescan', async () => {
  const f = await fixture();
  assert.equal(
    (await validateProjectRepositories(ProjectSchema.parse(f.project))).rootPath,
    undefined,
  );
  const before = await discoverRepositories(f.root);
  await rename(path.join(f.root, 'backend'), path.join(f.root, 'service'));
  const after = await discoverRepositories(f.root);
  assert.ok(!after.repositories.some((r) => path.basename(r.path) === 'backend'));
  assert.ok(after.repositories.some((r) => path.basename(r.path) === 'service'));
  assert.equal(
    after.repositories.find((r) => path.basename(r.path) === 'frontend')?.id,
    before.repositories.find((r) => path.basename(r.path) === 'frontend')?.id,
  );
});

void test('desktop and CLI worker protocol expose the same discovery and validate requests', async () => {
  const f = await fixture();
  const client = new WorkerClient({ ...process.env, AIDEN_HOME: path.join(f.root, '.aiden') });
  try {
    const result = await client.request('discoverRepositories', { rootPath: f.root });
    assert.equal(result.repositories.length, 2);
    await assert.rejects(client.request('discoverRepositories', { rootPath: '' }));
  } finally {
    client.close();
  }
});
