#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { teamsAuth } from '../../../packages/contracts/src/teams-auth.js';
import { WorkerClient } from '../../../packages/core/src/client.js';
import { loopbackCallback, readStatus, TeamsHost } from './teams-host.js';
import { wakeSecret, wakeSettings } from './wake.js';

/** Write one timestamped line to the service log. */
function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

/** The app version from the repository's package.json, from source or from the built dist folder. */
function appVersion(): string {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const root = path.basename(source) === 'dist' ? path.dirname(source) : source;
  try {
    const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof version === 'string' ? `${version}-linux` : 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * Minutes with no team work before a woken worker stops itself (`AIDEN_IDLE_STOP_MINUTES`), or
 * zero to stay on. It only applies when wakes are on, so the team can start the machine again.
 */
function idleStopMs(env: NodeJS.ProcessEnv): number {
  const minutes = Number(env.AIDEN_IDLE_STOP_MINUTES ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(1, minutes) * 60_000 : 0;
}

/**
 * Run the Teams worker until SIGINT, SIGTERM, or a quiet spell with wakes on; exit non-zero if the
 * worker dies, so it restarts, and zero otherwise, so a stopped Fly.io machine stays stopped.
 */
function serve(root: string): void {
  if (process.platform === 'linux' && !process.env.AIDEN_CREDENTIAL_STORE)
    log(
      'AIDEN_CREDENTIAL_STORE is not set, so sign-ins use the desktop keychain. On a server without one, set it to file.',
    );
  const worker = new WorkerClient({
    ...process.env,
    AIDEN_HOME: root,
    AIDEN_APP_VERSION: process.env.AIDEN_APP_VERSION || appVersion(),
  });
  const wake = wakeSettings();
  const idleMs = wake ? idleStopMs(process.env) : 0;
  let stopping = false;
  /** Checkpoint running work, then exit cleanly with a reason for the log. */
  const stop = (reason: string): void => {
    if (stopping) return;
    stopping = true;
    log(reason);
    void host.stop().finally(() => process.exit(0));
  };
  const host = new TeamsHost({
    worker,
    root,
    log,
    ...(wake ? { wake: { ...wake, secret: wakeSecret() } } : {}),
    ...(idleMs ? { idleStopMs: idleMs, onIdle: () => stop('Shutting down.') } : {}),
  });
  worker.on('workerStopped', () => {
    if (stopping) return;
    log('The Aiden worker stopped unexpectedly. Exiting so the machine restarts it.');
    process.exit(1);
  });
  /** Stop on a signal; a running task saves its checkpoint first. */
  const signalled = (): void =>
    stop('Stopping. A running task saves its checkpoint, and the team can hand it out again.');
  process.on('SIGTERM', signalled);
  process.on('SIGINT', signalled);
  log(`Aiden Teams worker ${process.env.AIDEN_APP_VERSION || appVersion()} using ${root}.`);
  host.start();
}

/** Walk a person through the sign-in that `serve` keeps waiting, forwarding the browser's redirect. */
async function signIn(root: string): Promise<void> {
  const status = await readStatus(root);
  if (!status)
    throw new Error(
      'The Teams worker has not started on this machine yet. Start aiden serve, then try again.',
    );
  if (status.signedIn) {
    process.stdout.write(`Already signed in as ${status.email ?? 'an unknown address'}.\n`);
    return;
  }
  if (!status.signInUrl)
    throw new Error('The Teams worker has no sign-in waiting yet. Try again in a few seconds.');
  if (!process.stdin.isTTY)
    throw new Error(
      'Sign-in needs an interactive terminal. On Fly.io run: fly ssh console --pty -C "aiden sign-in"',
    );
  process.stdout.write(
    `1. Open this address in a browser on your own computer and sign in to Aiden Teams:\n\n${status.signInUrl}\n\n` +
      '2. The browser then shows that it cannot reach 127.0.0.1. That is expected: this machine is waiting for that address.\n' +
      '   Copy the whole address from the browser address bar.\n\n',
  );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = await terminal
    .question('3. Paste the address here: ')
    .finally(() => terminal.close());
  const callback = loopbackCallback(pasted, teamsAuth(process.env).ports);
  const response = await fetch(callback, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok)
    throw new Error(
      'That sign-in is no longer waiting. Each one lasts five minutes. Run aiden sign-in again.',
    );
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(3_000);
    const next = await readStatus(root);
    if (next?.signedIn) {
      process.stdout.write(
        `Signed in as ${next.email ?? 'an unknown address'}. This machine now picks up team work.\n`,
      );
      return;
    }
    if (next && next.signInUrl !== status.signInUrl)
      throw new Error(next.message ?? 'Sign-in did not finish. Run aiden sign-in again.');
  }
  throw new Error(
    'The browser sign-in was received but the worker has not confirmed it yet. Check aiden status in a minute.',
  );
}

/** Print the published state in a few lines. */
async function printStatus(root: string): Promise<void> {
  const status = await readStatus(root);
  if (!status) throw new Error('The Teams worker has not started on this machine yet.');
  const lines = [
    `Machine: ${status.deviceName}`,
    `Teams: ${status.signedIn ? `signed in as ${status.email ?? 'an unknown address'}` : 'signed out (run aiden sign-in)'}`,
    `Task: ${status.running ? status.running.title : 'none'}`,
    `Wakes: ${status.wakeUrl ?? 'off (stays on)'}`,
    ...(status.last ? [`Last answer: ${status.last.type}, ${status.last.reason}`] : []),
    ...(status.message ? [`Note: ${status.message}`] : []),
    `Updated: ${status.updatedAt}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

// The `aiden` command: the Teams worker commands run here without starting a second worker
// process; every other command, and the help text, comes from the project CLI.
const root = path.resolve(process.env.AIDEN_HOME || path.join(homedir(), '.aiden'));
const command = process.argv[2];
if (command === 'serve' || command === 'sign-in' || command === 'status') {
  try {
    if (command === 'serve') serve(root);
    else if (command === 'sign-in') await signIn(root);
    else await printStatus(root);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : 'Command failed.') + '\n');
    process.exitCode = 1;
  }
} else await import('./index.js');
