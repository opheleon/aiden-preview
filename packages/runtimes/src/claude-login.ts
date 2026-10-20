import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { claudeBinary, ClaudeConnectionError } from './claude-auth.js';

const exec = promisify(execFile);

/** What opening Claude sign-in needs from the system; tests replace the terminal launcher. */
export interface ClaudeSignInDeps {
  platform: NodeJS.Platform;
  binary: () => string;
  openTerminal: (script: string) => Promise<void>;
}

/** Quote one argument for a POSIX shell script, so a path with spaces or quotes stays one word. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Open a macOS Terminal window running the script, using the system launcher only. */
async function openMacTerminal(script: string): Promise<void> {
  await exec('/usr/bin/open', ['-a', 'Terminal', script]);
}

const defaults: ClaudeSignInDeps = {
  platform: process.platform,
  binary: claudeBinary,
  openTerminal: openMacTerminal,
};

/**
 * Open Claude Code's own subscription sign-in in a Terminal window. Claude Code has no
 * non-interactive login API, so the person finishes sign-in in its browser flow and Aiden only
 * detects the result through Check connection. No credential passes through Aiden, and the
 * one-line script removes itself when it runs.
 * Example: on macOS this opens Terminal running `claude auth login --claudeai`.
 */
export async function openClaudeSignIn(deps: ClaudeSignInDeps = defaults): Promise<void> {
  if (deps.platform !== 'darwin')
    throw new ClaudeConnectionError(
      'sign_in_required',
      'Open a terminal, run claude auth login --claudeai, then select Check connection.',
    );
  const binary = deps.binary();
  const folder = await mkdtemp(path.join(tmpdir(), 'aiden-claude-sign-in-'));
  const script = path.join(folder, 'Sign in to Claude.command');
  await writeFile(
    script,
    `#!/bin/sh\nrm -f -- "$0"\n${shellQuote(binary)} auth login --claudeai\n`,
    { mode: 0o700 },
  );
  await deps.openTerminal(script);
}
