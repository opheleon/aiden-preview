import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import {
  type DesktopReadiness,
  DesktopTestSchema,
} from '../../../packages/contracts/src/desktop-verification.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';

/** Print each readiness check with a mark, so the remaining setup step is obvious. */
function printReadiness(value: DesktopReadiness): void {
  for (const check of value.checks)
    process.stdout.write(
      `${check.ready ? 'ready  ' : 'missing'}  ${check.name}: ${check.message}\n`,
    );
}

/** Run one desktop test and follow it, copying the evidence folder when asked. */
async function verify(client: WorkerClient, configFile: string, out?: string): Promise<void> {
  const config = DesktopTestSchema.parse(JSON.parse(await readFile(configFile, 'utf8')));
  const { runId } = await client.request('desktopTest', config);
  let prior = '';
  for (;;) {
    const run = await client.request('desktopRun', { runId });
    if (!run) throw new Error('The desktop run was not saved.');
    if (prior !== run.message) process.stderr.write(run.message + '\n');
    prior = run.message;
    if (run.status !== 'running') {
      let report = run.reportPath;
      if (out) {
        await cp(path.dirname(report), path.resolve(out), { recursive: true });
        report = path.join(path.resolve(out), 'report.html');
      }
      process.stdout.write(`Evidence: ${report}\n`);
      if (run.status !== 'completed') throw new Error(run.message);
      return;
    }
    await setTimeout(1000);
  }
}

/** Check permissions, list installed apps, or test one installed app. */
export async function desktopCommand(
  client: WorkerClient,
  command: string,
  options: { config?: string | undefined; out?: string | undefined },
): Promise<void> {
  if (command === 'verify-desktop') {
    if (!options.config) throw new Error('Use verify-desktop --config desktop-test.json.');
    return verify(client, options.config, options.out);
  }
  if (command === 'desktop-apps') {
    for (const app of await client.request('desktopApps', {}))
      process.stdout.write(`${app.name}  ${app.version}  ${app.path}\n`);
    return;
  }
  printReadiness(await client.request('desktopRequestAccess', {}));
}
