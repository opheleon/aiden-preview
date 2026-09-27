import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  atomic,
  boundedPath,
  hash,
  json,
  optionalJson,
  Store,
  uid,
} from '../packages/core/src/storage.js';

void test('atomic storage preserves previous data on cancellation and cleans a failed replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-storage-'));
  const file = path.join(root, 'value.json');
  await atomic(file, { revision: 1 });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(atomic(file, { revision: 2 }, AbortSignal.abort()), /abort/i);
  assert.deepEqual(await json(file), { revision: 1 });
  await assert.rejects(atomic(file, undefined), /undefined/);
  await mkdir(path.join(root, 'directory'));
  await assert.rejects(atomic(path.join(root, 'directory'), { revision: 2 }));
  assert.equal((await readdir(root)).filter((name) => name.endsWith('.tmp')).length, 0);
  await atomic(file, { revision: 3 });
  assert.deepEqual(await json(file), { revision: 3 });
});

void test('optional JSON distinguishes missing, malformed, and unreadable files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-json-'));
  assert.equal(await optionalJson(path.join(root, 'missing.json')), null);
  await writeFile(path.join(root, 'corrupt.json'), '{');
  await assert.rejects(optionalJson(path.join(root, 'corrupt.json')), SyntaxError);
  await assert.rejects(optionalJson(root));
});

void test('artifact resolution rejects traversal and symlinks while permitting new nested files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-path-'));
  await symlink(tmpdir(), path.join(root, 'escape'));
  await assert.rejects(boundedPath(root, '../outside.json'), /Unsafe/);
  await assert.rejects(boundedPath(root, 'escape/outside.json'), /Symlink/);
  assert.equal(
    await boundedPath(root, 'nested/new.json'),
    path.join(await realpath(root), 'nested/new.json'),
  );
  await writeFile(path.join(root, 'regular'), 'text');
  await assert.rejects(boundedPath(root, 'regular/child.json'));
});

void test('store validates identities, filters invalid names, and exposes directory failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-store-'));
  const store = new Store(root);
  assert.throws(() => store.project('../outside'));
  assert.throws(() => store.run('project', '../outside'));
  assert.deepEqual(await store.listRuns('project'), []);
  await mkdir(store.run('project', 'run-1'), { recursive: true });
  await mkdir(path.join(store.project('project'), 'runs', 'invalid name'));
  assert.deepEqual(await store.listRuns('project'), ['run-1']);
  await mkdir(store.project('broken'), { recursive: true });
  await writeFile(path.join(store.project('broken'), 'runs'), 'not a directory');
  await assert.rejects(store.listRuns('broken'));
  assert.notEqual(uid(), uid());
  assert.equal(hash({ a: 1 }), hash({ a: 1 }));
});
