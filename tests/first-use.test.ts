import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FirstUsePreferences } from '../apps/desktop/src/first-use.js';

void test('only confirmed completion persists across instances; replay preserves its original timestamp and unrelated data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-first-use-'));
  const file = path.join(root, 'preferences', 'first-use.json');
  const preferences = new FirstUsePreferences(root);
  await writeFile(path.join(root, 'project-sentinel'), 'Keep this synthetic project');
  assert.deepEqual(await preferences.read(), { completed: false, issue: null });
  assert.deepEqual(await new FirstUsePreferences(root).read(), { completed: false, issue: null });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal((await preferences.complete()).completed, true);
  const saved = await readFile(file, 'utf8');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await new FirstUsePreferences(root).read()).completed, true);
  await Promise.all([preferences.complete(), preferences.complete()]);
  assert.equal(await readFile(file, 'utf8'), saved);
  assert.equal(
    await readFile(path.join(root, 'project-sentinel'), 'utf8'),
    'Keep this synthetic project',
  );
});

void test('corrupt state is visible and repairable; failed writes stay incomplete and can be retried', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-first-use-errors-'));
  const file = path.join(root, 'preferences', 'first-use.json');
  await mkdir(path.dirname(file));
  const preferences = new FirstUsePreferences(root);
  for (const invalid of [
    '{',
    '{"completed":true}',
    '{"schemaVersion":1,"completedAt":"invalid"}',
  ]) {
    await writeFile(file, invalid);
    assert.deepEqual(await preferences.read(), { completed: false, issue: 'corrupt' });
  }
  await preferences.complete();
  assert.equal((await preferences.read()).completed, true);
  await rm(file);
  await mkdir(file);
  assert.deepEqual(await preferences.read(), { completed: false, issue: 'unavailable' });
  await assert.rejects(preferences.complete(), /Could not save your guide confirmation/);
  assert.equal((await preferences.read()).completed, false);
  await rm(file, { recursive: true });
  assert.equal((await preferences.complete()).completed, true);
});

void test('a symlink cannot redirect guide preferences outside the local workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-first-use-link-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'aiden-first-use-outside-'));
  await symlink(outside, path.join(root, 'preferences'));
  const preferences = new FirstUsePreferences(root);
  assert.deepEqual(await preferences.read(), { completed: false, issue: 'unavailable' });
  await assert.rejects(preferences.complete(), /Could not save/);
  await assert.rejects(readFile(path.join(outside, 'first-use.json')), { code: 'ENOENT' });
});
