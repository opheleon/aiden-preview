import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { commitBaseline } from '../packages/core/src/baseline.js';
import { Engine } from '../packages/core/src/engine.js';
import { repositoryHeads } from '../packages/core/src/look.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import { remoteDeliveryVerified } from '../packages/reporting/src/delivery-source.js';
import { fetchRemoteDefault, remoteDefault } from '../packages/tools/src/remote-default.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture, g } from './helpers.js';

async function remoteFixture() {
  const f = await fixture();
  for (const repo of f.project.repositories) {
    const remote = path.join(f.root, `${repo.id}.git`);
    await g(f.root, 'clone', '--bare', repo.path, remote);
    await g(repo.path, 'remote', 'add', 'origin', remote);
    repo.monitoredBranch = { remote: 'origin', branch: 'main' };
  }
  return f;
}

void test('remote default evidence excludes local, dirty, feature and worktree commits without altering them', async () => {
  const f = await remoteFixture();
  const repo = f.project.repositories[0]!;
  const before = await remoteDefault(repo);
  await g(repo.path, 'checkout', '-b', 'feature');
  await writeFile(path.join(repo.path, 'local.txt'), 'local implementation');
  await g(repo.path, 'add', '.');
  await g(repo.path, 'commit', '-m', 'Local feature');
  await g(repo.path, 'push', '-u', 'origin', 'feature');
  await writeFile(path.join(repo.path, 'dirty.txt'), 'unsaved delivery');
  const local = await g(repo.path, 'rev-parse', 'HEAD');
  const dirty = await g(repo.path, 'status', '--porcelain');
  const fetched = await fetchRemoteDefault(repo);
  assert.equal(fetched.sha, before.sha);
  assert.equal(fetched.branch, 'origin/main');
  assert.notEqual(fetched.sha, local);
  assert.equal(await g(repo.path, 'rev-parse', 'HEAD'), local);
  assert.equal(await g(repo.path, 'status', '--porcelain'), dirty);
  assert.equal(await readFile(path.join(repo.path, 'dirty.txt'), 'utf8'), 'unsaved delivery');
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, new FixtureRuntime(f));
  try {
    await atomic(path.join(store.project(f.project.id), 'project.json'), f.project);
    await commitBaseline(store, f.project.id, f.product, f.project.context);
    const run = await engine.report(f.project.id);
    await engine.wait(run.runId);
    const report = await engine.getReport(f.project.id, run.runId);
    assert.ok(remoteDeliveryVerified(report));
    assert.ok(report.snapshots.every((s) => s.source === 'remote-branch'));
    assert.equal(report.snapshots.find((s) => s.repositoryId === repo.id)?.sha, before.sha);
    assert.ok(!report.snapshots.some((s) => s.sha === local));
    assert.equal(await g(repo.path, 'rev-parse', 'HEAD'), local);
  } finally {
    await engine.dispose();
  }
});

void test('watching detects a remote-only push while local HEAD and remote-tracking refs stay unchanged', async () => {
  const f = await remoteFixture();
  const repo = f.project.repositories[0]!;
  const before = await remoteDefault(repo);
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, new FixtureRuntime(f));
  try {
    await atomic(path.join(store.project(f.project.id), 'project.json'), f.project);
    await commitBaseline(store, f.project.id, f.product, f.project.context);
    await atomic(path.join(store.project(f.project.id), 'looked-heads.json'), {
      at: new Date().toISOString(),
      repositories: await Promise.all(
        f.project.repositories.map(async (r) => ({
          repositoryId: r.id,
          sha: (await remoteDefault(r)).sha,
        })),
      ),
    });
    assert.equal((await repositoryHeads(engine, f.project.id)).changed, false);
    const clone = path.join(f.root, 'other');
    await g(f.root, 'clone', path.join(f.root, `${repo.id}.git`), clone);
    await writeFile(path.join(clone, 'remote.txt'), 'merged remotely');
    await g(clone, 'add', '.');
    await g(clone, 'commit', '-m', 'Remote change');
    await g(clone, 'push');
    assert.equal((await repositoryHeads(engine, f.project.id)).changed, true);
    assert.equal(await g(repo.path, 'rev-parse', 'HEAD'), before.sha);
    await assert.rejects(g(repo.path, 'rev-parse', '--verify', 'refs/remotes/origin/main'));
    assert.notEqual((await fetchRemoteDefault(repo)).sha, before.sha);
    assert.equal(await g(repo.path, 'rev-parse', 'HEAD'), before.sha);
  } finally {
    await engine.dispose();
  }
});

void test('missing, ambiguous, offline and invalid remote defaults never fall back to local delivery evidence', async () => {
  const f = await fixture();
  const repo = f.project.repositories[0]!;
  await assert.rejects(remoteDefault(repo), /Configure origin/);
  await g(repo.path, 'remote', 'add', 'upstream', path.join(f.root, 'missing.git'));
  await assert.rejects(remoteDefault(repo), /Git operation failed/);
  await g(repo.path, 'remote', 'add', 'second', path.join(f.root, 'second.git'));
  await assert.rejects(remoteDefault(repo), /Configure origin/);
  const bare = path.join(f.root, 'empty.git');
  await mkdir(bare);
  await g(bare, 'init', '--bare');
  await g(repo.path, 'remote', 'add', 'origin', bare);
  await assert.rejects(remoteDefault(repo), /default branch could not be verified/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchRemoteDefault(repo, controller.signal));
  assert.equal(remoteDeliveryVerified({ snapshots: f.snapshots }), false);
  assert.equal(remoteDeliveryVerified({ snapshots: [] }), false);
});

void test('a single non-origin remote and its actual default name are supported', async () => {
  const f = await fixture();
  const repo = f.project.repositories[0]!;
  await g(repo.path, 'branch', '-m', 'trunk');
  const remote = path.join(f.root, 'remote.git');
  await g(f.root, 'clone', '--bare', repo.path, remote);
  await g(repo.path, 'remote', 'add', 'upstream', remote);
  assert.equal((await fetchRemoteDefault(repo)).branch, 'upstream/trunk');
});
