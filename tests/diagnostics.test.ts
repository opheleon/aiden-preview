import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalDiagnostics } from '../apps/desktop/src/diagnostics.js';

void test('local diagnostics retain only bounded allowlisted data with owner-only access', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-diagnostics-'));
  const diagnostics = new LocalDiagnostics(root);
  const file = path.join(root, 'diagnostics', 'events.json');
  await mkdir(path.dirname(file));
  await writeFile(
    file,
    JSON.stringify([
      {
        at: new Date().toISOString(),
        component: 'worker',
        code: 'worker_stopped',
        message: 'private source and credentials',
      },
    ]),
  );
  for (let index = 0; index < 103; index++)
    await diagnostics.record({ component: 'worker', code: 'worker_stopped' });
  const text = await readFile(file, 'utf8');
  assert.doesNotMatch(text, /private source|credentials/);
  assert.equal(JSON.parse(text).length, 100);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await diagnostics.record({
    component: 'worker',
    code: 'worker_stopped',
    prompt: 'sensitive',
  } as never);
  assert.equal(await readFile(file, 'utf8'), text);
});

void test('diagnostics recover from corrupt state and cannot throw during startup recovery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-diagnostics-'));
  await mkdir(path.join(root, 'diagnostics'));
  await writeFile(path.join(root, 'diagnostics', 'events.json'), '{');
  await new LocalDiagnostics(root).record({ component: 'startup', code: 'startup_failed' });
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'diagnostics', 'events.json'), 'utf8')).length,
    1,
  );
  await writeFile(path.join(root, 'blocked'), 'not a directory');
  await new LocalDiagnostics(path.join(root, 'blocked')).record({
    component: 'startup',
    code: 'startup_failed',
  });
});
