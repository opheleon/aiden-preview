import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { claudeBinary } from '../packages/runtimes/src/claude-auth.js';

void test('Claude Finder lookup shares provider PATH, preserves installed CLI priority, and honors explicit overrides', (t) => {
  const before = { ...process.env };
  const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const local = path.join('/synthetic/home', '.local', 'bin', executable);
  const custom = path.join('/synthetic/bin', executable);
  const homebrew = path.join('/opt/homebrew/bin', executable);
  let available = new Set([local, custom, homebrew]);
  t.mock.method(fs, 'accessSync', (candidate: fs.PathLike) => {
    if (!available.has(String(candidate))) throw new Error('Synthetic missing executable');
  });
  syncBuiltinESMExports();
  try {
    delete process.env.AIDEN_CLAUDE_BINARY;
    process.env.HOME = '/synthetic/home';
    process.env.PATH = '/synthetic/bin';
    assert.equal(claudeBinary(), local);
    available.delete(local);
    assert.equal(claudeBinary(), custom);
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    if (process.platform === 'darwin') assert.equal(claudeBinary(), homebrew);
    else assert.throws(() => claudeBinary(), /runtime unavailable/);
    process.env.AIDEN_CLAUDE_BINARY = custom;
    assert.equal(claudeBinary(), custom);
    process.env.AIDEN_CLAUDE_BINARY = 'relative-claude';
    assert.throws(() => claudeBinary(), /absolute executable path/);
    process.env.AIDEN_CLAUDE_BINARY = '/synthetic/missing';
    assert.throws(() => claudeBinary(), /runtime unavailable/);
    delete process.env.AIDEN_CLAUDE_BINARY;
    available = new Set();
    assert.throws(() => claudeBinary(), /runtime unavailable/);
  } finally {
    process.env = before;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
