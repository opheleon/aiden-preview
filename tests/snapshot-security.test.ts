import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { ToolBroker } from '../packages/tools/src/broker.js';
import { freezeRepository, readSnapshot, syncRepository } from '../packages/tools/src/git.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

void test('evidence objects survive removal of the original checkout', async () => {
  const f = await fixture();
  const repo = required(f.project.repositories[0]);
  const frozen = await freezeRepository(
    repo,
    [required(f.snapshots[0]).sha],
    path.join(f.root, 'snapshot'),
  );
  await rm(repo.path, { recursive: true });
  assert.match(await readSnapshot(frozen, required(f.snapshots[0]), 'app.txt'), /GET \/books/);
});
void test('a shallow clone freezes as shallow, so history walks stop at its boundary', async () => {
  const f = await fixture();
  const source = required(f.project.repositories[0]);
  for (const n of [1, 2, 3]) {
    await writeFile(path.join(source.path, 'app.txt'), `GET /books ${n}`);
    await g(source.path, 'commit', '-am', `Change ${n} (#10${n})`);
  }
  const shallow = path.join(f.root, 'shallow');
  await g(f.root, 'clone', '--quiet', '--depth', '2', `file://${source.path}`, shallow);
  const sha = await g(shallow, 'rev-parse', 'HEAD');
  const frozen = await freezeRepository(
    { ...source, path: shallow },
    [sha],
    path.join(f.root, 'snapshot'),
  );
  assert.equal(await g(frozen.path, 'rev-parse', '--is-shallow-repository'), 'true');
  const history = await g(frozen.path, 'log', '--format=%s', '--grep=#101', sha, '--');
  assert.equal(history, '');
  assert.equal((await g(frozen.path, 'log', '--format=%s', sha)).split('\n').length, 2);
});
void test('a partial clone is refused by name instead of failing as remote corruption', async () => {
  const f = await fixture();
  const repo = required(f.project.repositories[0]);
  const snapshot = path.join(f.root, 'snapshot');
  const sha = required(f.snapshots[0]).sha;
  // Current Git marks a promisor remote; older Git sets extensions.partialClone.
  await g(repo.path, 'config', 'remote.origin.promisor', 'true');
  await assert.rejects(
    freezeRepository(repo, [sha], snapshot),
    /is a partial clone \(made with --filter\).*Clone the repository again without --filter/,
  );
  await g(repo.path, 'config', '--unset', 'remote.origin.promisor');
  await g(repo.path, 'config', 'extensions.partialClone', 'origin');
  await assert.rejects(freezeRepository(repo, [sha], snapshot), /is a partial clone/);
  await g(repo.path, 'config', '--unset', 'extensions.partialClone');
  await g(repo.path, 'config', 'remote.origin.promisor', 'false');
  assert.ok(await freezeRepository(repo, [sha], snapshot));
});
void test('receipts exclude truncated lines and reject an oversized line', async () => {
  const f = await fixture();
  const repo = required(f.project.repositories[0]);
  await writeFile(
    path.join(repo.path, 'large.txt'),
    'x'.repeat(7000) + '\n' + 'y'.repeat(7000) + '\n' + 'z'.repeat(16000),
  );
  await g(repo.path, 'add', '.');
  await g(repo.path, 'commit', '-m', 'Large lines');
  const sha = await g(repo.path, 'rev-parse', 'HEAD');
  const artifacts = path.join(f.root, 'artifacts');
  await mkdir(artifacts);
  const broker = new ToolBroker(f.project, artifacts, path.join(f.root, 'reads.json'), () =>
    Promise.resolve(''),
  );
  broker.snapshots = [{ ...required(f.snapshots[0]), sha }];
  const result: any = await broker.call('repo_read', {
    repositoryId: repo.id,
    sha,
    path: 'large.txt',
  });
  assert.equal(result.endLine, 1);
  assert.equal(required(broker.reads[0]).endLine, 1);
  assert.ok(!result.text.includes('yyyy'));
  await assert.rejects(
    broker.call('repo_read', { repositoryId: repo.id, sha, path: 'large.txt', startLine: 3 }),
    /exceeds/,
  );
  assert.equal(broker.reads.length, 1);
});
void test('executable filters are detected before status can invoke a clean filter', async () => {
  const f = await fixture();
  const repo = required(f.project.repositories[0]);
  const marker = path.join(f.root, 'filter-executed');
  await writeFile(path.join(repo.path, '.gitattributes'), 'app.txt filter=danger\n');
  await g(repo.path, 'add', '.');
  await g(repo.path, 'commit', '-m', 'Attributes');
  await g(repo.path, 'config', 'filter.danger.clean', `touch '${marker}'; cat`);
  await writeFile(path.join(repo.path, 'app.txt'), 'modified');
  assert.match((await syncRepository(repo)).join(), /filters/);
  await assert.rejects(readFile(marker), /ENOENT/);
});
void test('authentication rejection preserves checkout and reports stale inputs', async () => {
  const f = await fixture();
  const repo = required(f.project.repositories[0]);
  const sha = await g(repo.path, 'rev-parse', 'HEAD');
  const ssh = path.join(f.root, 'reject-ssh');
  await writeFile(ssh, '#!/bin/sh\necho "Permission denied (publickey)" >&2\nexit 255\n', {
    mode: 0o755,
  });
  await g(repo.path, 'remote', 'add', 'origin', 'ssh://git@example.invalid/project');
  await g(repo.path, 'config', 'core.sshCommand', ssh);
  await g(repo.path, 'config', 'branch.main.remote', 'origin');
  await g(repo.path, 'config', 'branch.main.merge', 'refs/heads/main');
  await g(repo.path, 'update-ref', 'refs/remotes/origin/main', sha);
  const before = await readFile(path.join(repo.path, 'app.txt'), 'utf8');
  assert.match((await syncRepository(repo)).join(), /freshness is unverified/);
  assert.equal(await g(repo.path, 'rev-parse', 'HEAD'), sha);
  assert.equal(await readFile(path.join(repo.path, 'app.txt'), 'utf8'), before);
});
