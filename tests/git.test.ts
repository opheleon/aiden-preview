import assert from 'node:assert/strict';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { readSnapshot, syncRepository } from '../packages/tools/src/git.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';
void test('clean checkout fast-forwards while dirty and diverged checkouts are preserved', async () => {
  const f = await fixture();
  const source = required(f.project.repositories[0]);
  const remote = path.join(f.root, 'remote.git');
  await g(f.root, 'clone', '--bare', source.path, remote);
  await g(source.path, 'remote', 'add', 'origin', remote);
  await g(source.path, 'push', '-u', 'origin', 'main');
  const other = path.join(f.root, 'other');
  await g(f.root, 'clone', remote, other);
  await writeFile(path.join(other, 'new.txt'), 'remote');
  await g(other, 'add', '.');
  await g(other, 'commit', '-m', 'Remote change');
  await g(other, 'push');
  assert.deepEqual(await syncRepository(source), []);
  assert.equal(await readFile(path.join(source.path, 'new.txt'), 'utf8'), 'remote');
  await writeFile(path.join(source.path, 'app.txt'), 'local edits');
  const before = await g(source.path, 'rev-parse', 'HEAD');
  assert.match((await syncRepository(source)).join(), /Local changes/);
  assert.equal(await readFile(path.join(source.path, 'app.txt'), 'utf8'), 'local edits');
  assert.equal(await g(source.path, 'rev-parse', 'HEAD'), before);
  await g(source.path, 'add', '.');
  await g(source.path, 'commit', '-m', 'Local work');
  await writeFile(path.join(other, 'remote2.txt'), 'another');
  await g(other, 'add', '.');
  await g(other, 'commit', '-m', 'Remote diverges');
  await g(other, 'push');
  const local = await g(source.path, 'rev-parse', 'HEAD');
  assert.match((await syncRepository(source)).join(), /Could not fast-forward/);
  assert.equal(await g(source.path, 'rev-parse', 'HEAD'), local);
});
void test('detached, missing upstream, filters, and offline cases preserve HEAD', async () => {
  const f = await fixture();
  const r = required(f.project.repositories[0]);
  const before = await g(r.path, 'rev-parse', 'HEAD');
  assert.match((await syncRepository(r)).join(), /No available upstream/);
  await g(r.path, 'checkout', '--detach');
  assert.match((await syncRepository(r)).join(), /Detached/);
  await g(r.path, 'checkout', 'main');
  await g(r.path, 'remote', 'add', 'origin', path.join(f.root, 'missing.git'));
  await g(r.path, 'config', 'branch.main.remote', 'origin');
  await g(r.path, 'config', 'branch.main.merge', 'refs/heads/main');
  await g(r.path, 'update-ref', 'refs/remotes/origin/main', before);
  await g(r.path, 'config', 'filter.danger.smudge', 'touch /tmp/aiden-never-execute');
  assert.match((await syncRepository(r)).join(), /filters/);
  await g(r.path, 'config', '--remove-section', 'filter.danger');
  assert.match((await syncRepository(r)).join(), /Could not fast-forward/);
  assert.equal(await g(r.path, 'rev-parse', 'HEAD'), before);
});
void test('snapshot reads refuse symlinks and synchronization does not run merge hooks', async () => {
  const f = await fixture();
  const r = required(f.project.repositories[0]);
  await symlink('/etc/passwd', path.join(r.path, 'outside'));
  await g(r.path, 'add', '.');
  await g(r.path, 'commit', '-m', 'Symlink');
  await assert.rejects(
    readSnapshot(
      r,
      { ...required(f.snapshots[0]), sha: await g(r.path, 'rev-parse', 'HEAD') },
      'outside',
    ),
    /regular file/,
  );
  const remote = path.join(f.root, 'remote.git');
  await g(f.root, 'clone', '--bare', r.path, remote);
  await g(r.path, 'remote', 'add', 'origin', remote);
  await g(r.path, 'push', '-u', 'origin', 'main');
  const other = path.join(f.root, 'clone');
  await g(f.root, 'clone', remote, other);
  await writeFile(path.join(other, 'new'), 'new');
  await g(other, 'add', '.');
  await g(other, 'commit', '-m', 'Advance');
  await g(other, 'push');
  const marker = path.join(f.root, 'hook-fired');
  await writeFile(path.join(r.path, '.git/hooks/post-merge'), `#!/bin/sh\ntouch '${marker}'\n`, {
    mode: 0o755,
  });
  await syncRepository(r);
  await assert.rejects(readFile(marker), /ENOENT/);
});
