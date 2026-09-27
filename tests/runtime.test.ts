import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanEnvironment, publicError, Runtimes } from '../packages/runtimes/src/index.js';
void test('environment and error filtering do not leak inherited unrelated credentials', () => {
  process.env.AIDEN_TEST_SECRET = 'never-propagate';
  assert.equal(cleanEnvironment().AIDEN_TEST_SECRET, undefined);
  delete process.env.AIDEN_TEST_SECRET;
  assert.equal(
    publicError(new Error('bad sk-test-secret Bearer sensitive-token')),
    'bad [redacted] Bearer [redacted]',
  );
});

void test('cancellation interrupts a Codex process stuck during initialization', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-cancel-'));
  const executable = path.join(root, 'fake-codex');
  await writeFile(
    executable,
    '#!/usr/bin/env node\nprocess.on("SIGTERM",()=>{});setInterval(()=>{},1000);\n',
    { mode: 0o755 },
  );
  const previous = process.env.AIDEN_CODEX_BINARY;
  process.env.AIDEN_CODEX_BINARY = executable;
  const runtime = new Runtimes(root);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  const start = Date.now();
  try {
    await assert.rejects(
      runtime.run({
        config: { provider: 'codex', auth: 'subscription' },
        prompt: 'test',
        schema: {},
        cwd: root,
        tools: { url: 'http://127.0.0.1:1/mcp', token: 'test' },
        signal: controller.signal,
        progress: () => {},
      }),
    );
    assert.ok(Date.now() - start < 1500, 'initialization must not wait for its normal RPC timeout');
  } finally {
    clearTimeout(timer);
    runtime.dispose();
    if (previous === undefined) delete process.env.AIDEN_CODEX_BINARY;
    else process.env.AIDEN_CODEX_BINARY = previous;
  }
});
