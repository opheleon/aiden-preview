import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Engine } from '../packages/core/src/engine.js';
import {
  initializeMonitoring,
  monitoringBranches,
  saveMonitoredBranch,
} from '../packages/core/src/monitoring.js';
import { acquireProjectLock } from '../packages/core/src/run-lifecycle.js';
import { atomic, optionalJson, Store } from '../packages/core/src/storage.js';
import { createMethods, type RuntimeControls } from '../packages/core/src/worker-methods.js';
import {
  currentRemoteBranch,
  fetchMonitoredBranch,
  monitoredHead,
  remoteBranches,
  withMonitoredBranches,
} from '../packages/tools/src/remote-branches.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture, g } from './helpers.js';

async function setup() {
  const f = await fixture();
  const repo = f.project.repositories[0]!;
  await g(f.root, 'clone', '--bare', repo.path, path.join(f.root, 'origin.git'));
  await g(repo.path, 'remote', 'add', 'origin', path.join(f.root, 'origin.git'));
  await g(repo.path, 'checkout', '-b', 'release');
  await g(repo.path, 'push', '-u', 'origin', 'release');
  const store = new Store(path.join(f.root, 'branch-data'));
  await atomic(path.join(store.project(f.project.id), 'project.json'), f.project);
  return { ...f, repo, store };
}

void test('project monitoring defaults to current upstream and stays pinned across local checkout changes', async () => {
  const f = await setup();
  const selected = await initializeMonitoring(f.store, f.project.id);
  assert.deepEqual(selected.repositories[0]?.monitoredBranch, {
    remote: 'origin',
    branch: 'release',
  });
  const repo = selected.repositories[0];
  const before = await monitoredHead(repo);
  await g(repo.path, 'checkout', 'main');
  assert.equal(
    (await initializeMonitoring(f.store, f.project.id)).repositories[0]?.monitoredBranch?.branch,
    'release',
  );
  const other = path.join(f.root, 'other');
  await g(f.root, 'clone', '-b', 'release', path.join(f.root, 'origin.git'), other);
  await writeFile(path.join(other, 'remote.txt'), 'release only');
  await g(other, 'add', '.');
  await g(other, 'commit', '-m', 'Release change');
  await g(other, 'push');
  const fetched = await fetchMonitoredBranch(repo);
  assert.notEqual(fetched.sha, before.sha);
  assert.equal(fetched.branch, 'origin/release');
  assert.equal(await g(repo.path, 'rev-parse', 'HEAD'), before.sha);
  assert.equal(await g(repo.path, 'branch', '--show-current'), 'main');
  await g(other, 'push', 'origin', '--delete', 'release');
  await assert.rejects(monitoredHead(repo), /unavailable on the remote/);
});

void test('branch choices are live, project-scoped and guarded; switching invalidates current evidence only', async () => {
  const f = await setup();
  const folder = f.store.project(f.project.id);
  await initializeMonitoring(f.store, f.project.id);
  const otherProject = { ...f.project, id: 'other-project' };
  await atomic(path.join(f.store.project(otherProject.id), 'project.json'), otherProject);
  for (const file of [
    'latest.json',
    'latest-estimate.json',
    'latest-verification.json',
    'looked-heads.json',
    'history.json',
  ])
    await atomic(path.join(folder, file), { id: 'old' });
  assert.deepEqual(
    (await monitoringBranches(f.store, f.project.id, f.repo.id)).branches.map((b) => b.branch),
    ['main', 'release'],
  );
  await assert.rejects(
    monitoringBranches(f.store, f.project.id, 'foreign'),
    /Unknown project repository/,
  );
  const main = { remote: 'origin', branch: 'main' };
  await assert.rejects(
    saveMonitoredBranch(f.store, f.project.id, 'foreign', main),
    /Unknown project repository/,
  );
  await assert.rejects(
    saveMonitoredBranch(f.store, f.project.id, f.repo.id, { ...main, branch: '*' }),
  );
  await assert.rejects(
    saveMonitoredBranch(f.store, f.project.id, f.repo.id, { ...main, remote: '--upload-pack=bad' }),
    /unavailable/,
  );
  const release = await acquireProjectLock(f.store, f.project.id, 'browser');
  await assert.rejects(
    saveMonitoredBranch(f.store, f.project.id, f.repo.id, main),
    /active operation/,
  );
  await release();
  const saved = await saveMonitoredBranch(f.store, f.project.id, f.repo.id, main);
  assert.deepEqual(saved.repositories[0]?.monitoredBranch, main);
  assert.equal(await optionalJson(path.join(folder, 'latest.json')), null);
  assert.deepEqual(await optionalJson(path.join(folder, 'history.json')), { id: 'old' });
  assert.deepEqual(
    await optionalJson(path.join(f.store.project(otherProject.id), 'project.json')),
    otherProject,
  );
  await atomic(path.join(folder, 'latest.json'), { id: 'new' });
  await saveMonitoredBranch(f.store, f.project.id, f.repo.id, main);
  assert.deepEqual(await optionalJson(path.join(folder, 'latest.json')), { id: 'new' });
});

void test('missing, unpushed, detached and inaccessible branches stay unknown with retryable choices', async () => {
  const f = await fixture();
  const repo = f.project.repositories[0]!;
  assert.equal(await currentRemoteBranch(repo), undefined);
  assert.ok((await remoteBranches(repo)).warnings.length);
  await assert.rejects(monitoredHead(repo), /Choose a remote branch/);
  await g(repo.path, 'remote', 'add', 'upstream', path.join(f.root, 'absent.git'));
  assert.deepEqual(await currentRemoteBranch(repo), { remote: 'upstream', branch: 'main' });
  assert.ok((await remoteBranches(repo)).warnings.length);
  await assert.rejects(monitoredHead(repo), /Git operation failed/);
  await g(repo.path, 'remote', 'add', 'second', path.join(f.root, 'absent2.git'));
  assert.equal(await currentRemoteBranch(repo), undefined);
  await g(repo.path, 'checkout', '--detach');
  assert.equal(await currentRemoteBranch(repo), undefined);
  assert.equal(
    (await withMonitoredBranches(f.project)).repositories[0]?.monitoredBranch,
    undefined,
  );
  const invalid = { ...f.project, repositories: [{ ...repo, path: '/nonexistent-aiden-repo' }] };
  assert.deepEqual(await withMonitoredBranches(invalid), invalid);
});

void test('worker branch operations reject arbitrary paths and stale runs cannot resume after a branch change', async () => {
  const f = await setup();
  const engine = new Engine(f.store, new FixtureRuntime(f));
  try {
    const methods = createMethods(engine, {} as RuntimeControls);
    assert.throws(() =>
      methods.remoteBranches({
        projectId: f.project.id,
        repositoryId: f.repo.id,
        path: '/outside',
      }),
    );
    assert.throws(() =>
      methods.updateMonitoredBranch({
        projectId: f.project.id,
        repositoryId: f.repo.id,
        monitoredBranch: { remote: '--unsafe', branch: 'main' },
      }),
    );
    const project = await initializeMonitoring(f.store, f.project.id);
    const runId = 'old-branch-run';
    await atomic(path.join(f.store.run(f.project.id, runId), 'manifest.json'), {
      id: runId,
      projectId: f.project.id,
      project,
      kind: 'report',
      status: 'failed',
      stage: 'assess',
      createdAt: new Date().toISOString(),
    });
    await methods.updateMonitoredBranch({
      projectId: f.project.id,
      repositoryId: f.repo.id,
      monitoredBranch: { remote: 'origin', branch: 'main' },
    });
    await assert.rejects(engine.resume(f.project.id, runId), /monitored branch changed/);
  } finally {
    await engine.dispose();
  }
});
