import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { openClaudeSignIn, shellQuote } from '../packages/runtimes/src/claude-login.js';

void test('Claude sign-in opens Claude Code login in Terminal with a quoted binary and no secrets', async () => {
  let opened = '';
  let contents = '';
  await openClaudeSignIn({
    platform: 'darwin',
    binary: () => "/Users/synthetic/Claude's tools/claude",
    openTerminal: async (script) => {
      opened = script;
      contents = await readFile(script, 'utf8');
    },
  });
  assert.match(opened, /Sign in to Claude\.command$/);
  assert.equal(
    contents,
    `#!/bin/sh\nrm -f -- "$0"\n'/Users/synthetic/Claude'\\''s tools/claude' auth login --claudeai\n`,
  );
  assert.doesNotMatch(contents, /key|token|password/i);
});

void test('Claude sign-in outside macOS explains the terminal command instead of guessing a launcher', async () => {
  await assert.rejects(
    openClaudeSignIn({
      platform: 'linux',
      binary: () => '/usr/bin/claude',
      openTerminal: () => Promise.reject(new Error('Synthetic launcher must not run')),
    }),
    /run claude auth login --claudeai/,
  );
});

void test('shell quoting keeps a path with spaces and quotes as one word', () => {
  assert.equal(shellQuote('/a b/c'), "'/a b/c'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});
