import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { cleanEnvironment } from '../../runtimes/src/environment.js';

/** Reserve an available loopback port; Appium still must bind successfully before use. */
async function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== 'string') resolve(address.port);
        else reject(new Error('Could not reserve a phone connection port.'));
      });
    });
  });
}
/** One owned loopback server per phone session; never adopts or stops an external Appium server. */
export class ManagedAppium {
  private child: ChildProcess | undefined;
  private folder = '';
  private exited: Promise<void> = Promise.resolve();
  private alive = false;
  /** Launch installed Appium with fixed settings and no repository configuration or raw logs. */
  async start(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    this.folder = await mkdtemp(path.join(os.tmpdir(), 'aiden-appium-'));
    try {
      const port = await availablePort();
      const config = path.join(this.folder, 'appium.json');
      await writeFile(
        config,
        JSON.stringify({ server: { address: '127.0.0.1', port, 'use-drivers': ['xcuitest'] } }),
        { mode: 0o600 },
      );
      signal.throwIfAborted();
      const child = spawn('appium', ['--config', config], {
        cwd: this.folder,
        env: cleanEnvironment(),
        stdio: 'ignore',
        detached: true,
      });
      this.child = child;
      this.alive = true;
      this.exited = new Promise((resolve) => {
        child.once('error', () => {
          this.alive = false;
          resolve();
        });
        child.once('exit', () => {
          this.alive = false;
          resolve();
        });
      });
      const url = `http://127.0.0.1:${port}`;
      await this.ready(url, signal);
      return url;
    } catch {
      await this.stop();
      signal.throwIfAborted();
      throw new Error(
        'Could not start the phone connection. Check the shared iPhone setup for Appium and XCUITest availability.',
      );
    }
  }
  /** Wait for readiness with cancellation and an absolute deadline; discard all server response text. */
  private async ready(url: string, signal: AbortSignal): Promise<void> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    while (this.alive) {
      deadline.throwIfAborted();
      try {
        const response = await fetch(`${url}/status`, {
          redirect: 'error',
          signal: AbortSignal.any([deadline, AbortSignal.timeout(1000)]),
        });
        const ok = response.ok;
        await response.body?.cancel();
        if (ok && this.alive) return;
      } catch {
        /* Startup may briefly refuse connections. */
      }
      await setTimeout(200, undefined, { signal: deadline });
    }
    throw new Error('The phone connection exited before it was ready.');
  }
  /** Terminate only the process group created here, then remove private temporary configuration. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child?.pid && this.alive) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
      await Promise.race([this.exited, setTimeout(2000)]);
      if (this.alive) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
        await this.exited;
      }
    }
    if (this.folder) await rm(this.folder, { recursive: true, force: true });
    this.folder = '';
  }
}
