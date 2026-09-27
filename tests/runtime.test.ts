import assert from 'node:assert/strict';
import test from 'node:test';

import { ArtifactFormatError, parseJson } from '../packages/runtimes/src/environment.js';
import { cleanEnvironment, publicError, Runtimes } from '../packages/runtimes/src/index.js';

void test('Finder provider discovery includes Homebrew without leaking credentials or running shell profiles', () => {
  const source = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: '/synthetic/home',
    OPENAI_API_KEY: 'unrelated-key',
    NODE_OPTIONS: '--require=/untrusted/file',
  };
  assert.deepEqual(cleanEnvironment(source, 'darwin'), {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:/synthetic/home/.local/bin',
    HOME: '/synthetic/home',
  });
  assert.deepEqual(cleanEnvironment(source, 'linux'), { PATH: source.PATH, HOME: source.HOME });
  assert.equal(
    cleanEnvironment({}, 'darwin').PATH,
    '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
  );
  assert.equal(
    cleanEnvironment({ PATH: '/custom/bin:/opt/homebrew/bin::/usr/local/bin' }, 'darwin').PATH,
    '/custom/bin:/opt/homebrew/bin:/usr/local/bin',
  );
  assert.equal(source.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  for (const HOME of ['relative/home', '/invalid:home']) {
    assert.equal(cleanEnvironment({ HOME }, 'darwin').PATH, cleanEnvironment({}, 'darwin').PATH);
  }
  assert.equal(
    cleanEnvironment(
      { HOME: '/synthetic/home', PATH: '/synthetic/home/.local/bin:/usr/bin' },
      'darwin',
    ).PATH,
    '/synthetic/home/.local/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin',
  );
});

void test('structured output accepts JSON fences and rejects malformed whitespace-heavy output', () => {
  for (const value of ['{"ok":true}', '```json\n{"ok":true}\n```', '```\n{"ok":true}\n```']) {
    assert.deepEqual(parseJson(` \n${value}\n `), { ok: true });
  }
  assert.equal(parseJson('"literal ```"'), 'literal ```');
  for (const value of [
    '```json\n{}',
    '{}\n```',
    '```javascript\n{}\n```',
    `{}${' '.repeat(100000)}!`,
  ]) {
    assert.throws(() => parseJson(value), ArtifactFormatError);
  }
});
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
