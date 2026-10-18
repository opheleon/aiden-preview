import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import {
  DeviceTargetSchema,
  DeviceTestSchema,
} from '../../../packages/contracts/src/device-verification.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';

/** Run installed-app checks without creating a project, importing a repository, or assessing code. */
export async function deviceCommand(
  client: WorkerClient,
  command: string,
  configFile?: string,
  out?: string,
): Promise<void> {
  if (!configFile) throw new Error(`Use ${command} --config device-test.json.`);
  const input: unknown = JSON.parse(await readFile(configFile, 'utf8'));
  if (command === 'device-probe') {
    const target = DeviceTargetSchema.parse(input);
    process.stdout.write(
      JSON.stringify(await client.request('deviceProbe', target), null, 2) + '\n',
    );
    return;
  }
  const config = DeviceTestSchema.parse(input);
  const { runId } = await client.request('deviceTest', config);
  let prior = '';
  for (;;) {
    const run = await client.request('deviceRun', { runId });
    if (!run) throw new Error('The device run was not saved.');
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
