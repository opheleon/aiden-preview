#!/usr/bin/env node
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { z } from 'zod/v3';

import {
  EstimateOverridesSchema,
  ProjectSchema,
  type RunEvent,
} from '../../../packages/contracts/src/index.js';
import { WorkerClient } from '../../../packages/core/src/client.js';
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string' },
    root: { type: 'string' },
    project: { type: 'string' },
    run: { type: 'string' },
    call: { type: 'string' },
    format: { type: 'string', default: 'markdown' },
    out: { type: 'string' },
    connection: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    auth: { type: 'string' },
    tools: { type: 'string' },
    source: { type: 'string' },
    label: { type: 'string' },
    historyTool: { type: 'string' },
    sourceArgument: { type: 'string' },
    includeEstimates: { type: 'boolean', default: false },
    refreshHistory: { type: 'boolean', default: false },
    clear: { type: 'boolean', default: false },
  },
});
const format = z.enum(['json', 'markdown']).parse(values.format);
const command = positionals[0];
const client = new WorkerClient();
const terminal = createInterface({ input: process.stdin, output: process.stderr });
process.on('SIGINT', () => {
  client.close();
  terminal.close();
});
/** Require an interactive terminal before accepting review or authentication input. */
const ask = async (q: string) => {
  if (!process.stdin.isTTY)
    throw new Error(
      'This operation needs user review. Use the desktop app or an interactive terminal.',
    );
  return terminal.question(q);
};
let resolveRun: (e: RunEvent) => void;
const events: RunEvent[] = [];
client.on('event', (e: RunEvent) => {
  events.push(e);
  // Some progress events only carry partial verification results for the desktop Watch view.
  if (e.type === 'progress' && e.message) process.stderr.write(`${e.message}\n`);
  // Aiden never waits on a call: it records the question and proceeds on its stated assumption.
  if (e.type === 'activity' && e.activity?.kind === 'ask')
    process.stderr.write(`${e.activity.summary}\n  ${e.activity.reason ?? ''}\n`);
  if (['completed', 'review', 'failed', 'cancelled'].includes(e.type)) resolveRun?.(e);
});
/** Await a terminal event, including events received before the request returned its run ID. */
async function wait(runId: string) {
  const prior = events.find(
    (e) => e.runId === runId && ['completed', 'review', 'failed', 'cancelled'].includes(e.type),
  );
  const e = prior ?? (await new Promise<RunEvent>((resolve) => (resolveRun = resolve)));
  if (e.type === 'failed' || e.type === 'cancelled') throw new Error(e.message);
  return e;
}
/** Write command output to stdout or a private-permission file selected by the user. */
async function output(text: string) {
  if (values.out) await writeFile(path.resolve(values.out), text + '\n', { mode: 0o600 });
  else process.stdout.write(text + '\n');
}
/** Execute an explicit connection operation, requiring current tool fingerprints for approval. */
async function connectionCommand(subcommand: string, connectionId: string): Promise<void> {
  if (subcommand === 'connect') {
    const result = await client.request('integrationConnect', {
      connectionId: connectionId,
    });
    if (result.authUrl) {
      process.stdout.write(`Open this authorization URL:\n${result.authUrl}\n`);
      await ask('Press Enter after authorization completes.');
    }
    await output(
      JSON.stringify(
        (await client.request('integrations')).find((row) => row.id === connectionId),
        null,
        2,
      ),
    );
  } else if (subcommand === 'tools') {
    await output(
      JSON.stringify(
        await client.request('integrationTools', { connectionId: connectionId }),
        null,
        2,
      ),
    );
  } else if (subcommand === 'approve') {
    const connections = await client.request('integrations');
    const connection = connections.find((row) => row.id === connectionId);
    if (!connection?.toolFingerprint)
      throw new Error('Test the connection and list its tools first.');
    const tools = (values.tools ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    await output(
      JSON.stringify(
        await client.request('integrationApprove', {
          connectionId: connectionId,
          tools,
          fingerprint: connection.toolFingerprint,
        }),
        null,
        2,
      ),
    );
  } else if (subcommand === 'disconnect') {
    await output(
      JSON.stringify(
        await client.request('integrationDisconnect', { connectionId: connectionId }),
        null,
        2,
      ),
    );
  } else if (subcommand === 'remove') {
    await output(
      JSON.stringify(
        await client.request('integrationRemove', { connectionId: connectionId }),
        null,
        2,
      ),
    );
  } else throw new Error('Unknown integrations command.');
}

try {
  if (command === 'doctor')
    await output(JSON.stringify(await client.request('diagnostics'), null, 2));
  else if (command === 'discover') {
    if (!values.root) throw new Error('Use discover --root /path/to/project.');
    await output(
      JSON.stringify(
        await client.request('discoverRepositories', { rootPath: path.resolve(values.root) }),
        null,
        2,
      ),
    );
  } else if (command === 'login') {
    const r = await client.request('login', { provider: 'codex' });
    process.stdout.write(`Open this provider sign-in URL:\n${r.authUrl}\n`);
    await ask('Press Enter after sign-in completes.');
  } else if (command === 'report') {
    let projectId = values.project;
    if (values.config) {
      const project = ProjectSchema.parse(JSON.parse(await readFile(values.config, 'utf8')));
      projectId = project.id;
      const p = await client.request('prepare', { project });
      const e = await wait(p.runId);
      await output(JSON.stringify(e.product, null, 2));
      const answer = await ask('Approve these requirements? [yes/no] ');
      if (answer.trim().toLowerCase() !== 'yes')
        throw new Error('Requirements were not approved. Review and edit them in the desktop app.');
      await client.request('approve', {
        projectId: projectId,
        runId: p.runId,
        product: e.product!,
      });
    }
    if (!projectId)
      throw new Error(
        'Use --config project.json for first setup or --project ID for a reviewed project.',
      );
    const r = await client.request('report', { projectId });
    await wait(r.runId);
    await output(
      await client.request('export', {
        projectId,
        runId: r.runId,
        format,
        includeEstimates: values.includeEstimates,
      }),
    );
  } else if (command === 'resume') {
    if (!values.project || !values.run) throw new Error('--project and --run are required.');
    const r = await client.request('resume', { projectId: values.project, runId: values.run });
    await output(JSON.stringify(await wait(r.runId), null, 2));
  } else if (command === 'validate' || command === 'export') {
    if (!values.project || !values.run) throw new Error('--project and --run are required.');
    const p = { projectId: values.project, runId: values.run };
    if (command === 'validate') {
      await client.request('result', p);
      await output('Report structure and recorded evidence are valid.');
    } else
      await output(
        await client.request('export', { ...p, format, includeEstimates: values.includeEstimates }),
      );
  } else if (command === 'integrations') {
    const subcommand = positionals[1] ?? 'list';
    if (subcommand === 'list')
      await output(JSON.stringify(await client.request('integrations'), null, 2));
    else if (subcommand === 'add-linear') {
      const connection = await client.request('integrationAdd', {
        name: values.name ?? 'Linear',
        provider: 'linear',
        url: 'https://mcp.linear.app/mcp/readonly',
        auth: 'oauth',
      });
      await output(JSON.stringify(connection, null, 2));
    } else if (subcommand === 'add') {
      if (!values.name || !values.url || !values.auth)
        throw new Error('--name, --url, and --auth are required.');
      const auth = z.enum(['oauth', 'bearer', 'none']).parse(values.auth);
      const bearer =
        auth === 'bearer'
          ? await ask('Bearer token (stored securely and never echoed in output): ')
          : undefined;
      const connection = await client.request('integrationAdd', {
        name: values.name,
        provider: 'custom',
        url: values.url,
        auth,
        ...(bearer === undefined ? {} : { bearer }),
      });
      await output(JSON.stringify(connection, null, 2));
    } else {
      if (!values.connection) throw new Error('--connection is required.');
      await connectionCommand(subcommand, values.connection);
    }
  } else if (command === 'sources') {
    if (!values.project) throw new Error('--project is required.');
    const sources =
      values.connection && values.source && values.historyTool && values.sourceArgument
        ? {
            contextConnectionIds: [values.connection],
            history: {
              connectionId: values.connection,
              sourceId: values.source,
              sourceLabel: values.label ?? values.source,
              historyTool: values.historyTool,
              sourceArgument: values.sourceArgument,
            },
          }
        : { contextConnectionIds: values.connection ? [values.connection] : [], history: null };
    await client.request('updateSources', { projectId: values.project, sources });
    await output('Project sources updated.');
  } else if (command === 'estimate') {
    if (!values.project) throw new Error('--project is required.');
    const result = await client.request('estimate', {
      projectId: values.project,
      ...(values.run ? { reportId: values.run } : {}),
      refreshHistory: values.refreshHistory,
    });
    await wait(result.runId);
    await output(
      JSON.stringify(await client.request('estimation', { projectId: values.project }), null, 2),
    );
  } else if (command === 'estimation') {
    if (!values.project) throw new Error('--project is required.');
    await output(
      JSON.stringify(await client.request('estimation', { projectId: values.project }), null, 2),
    );
  } else if (command === 'estimate-overrides') {
    if (!values.project || !values.config) throw new Error('--project and --config are required.');
    const overrides = EstimateOverridesSchema.parse(
      JSON.parse(await readFile(values.config, 'utf8')),
    );
    await output(
      JSON.stringify(
        await client.request('estimateOverrides', { projectId: values.project, overrides }),
        null,
        2,
      ),
    );
  } else if (command === 'calls') {
    if (!values.project) throw new Error('Use calls --project ID.');
    const calls = await client.request('calls', { projectId: values.project });
    await output(
      JSON.stringify(
        calls.filter((c) => c.status === 'open'),
        null,
        2,
      ),
    );
  } else if (command === 'answer') {
    if (!values.project || !values.call) throw new Error('Use answer --project ID --call ID.');
    const answer = await ask('Your answer: ');
    const r = await client.request('answerCall', {
      projectId: values.project,
      callId: values.call,
      answer,
    });
    process.stdout.write(
      r.runId
        ? `Answered. Aiden is looking again.\n`
        : 'Answered. Aiden uses it as soon as its current work finishes.\n',
    );
  } else if (command === 'verify-url') {
    if (!values.project) throw new Error('Use verify-url --project ID [--url URL | --clear].');
    const settings =
      values.url || values.clear
        ? await client.request('updateVerificationSettings', {
            projectId: values.project,
            url: values.clear ? null : (values.url ?? null),
          })
        : await client.request('verificationSettings', { projectId: values.project });
    process.stdout.write(`App URL: ${settings.url ?? 'not set'}\n`);
  } else if (command === 'verify') {
    if (!values.project) throw new Error('Use verify --project ID [--url http://localhost:3000].');
    const r = await client.request('verify', {
      projectId: values.project,
      ...(values.url ? { url: values.url } : {}),
    });
    await wait(r.runId);
    const saved = await client.request('verification', {
      projectId: values.project,
      runId: r.runId,
    });
    if (!saved) throw new Error('The verification result was not saved.');
    let reportPath = saved.reportPath;
    if (values.out) {
      // The report links its videos and screenshots by relative path, so copy the whole folder.
      await cp(path.dirname(saved.reportPath), path.resolve(values.out), { recursive: true });
      reportPath = path.join(path.resolve(values.out), 'report.html');
    }
    process.stdout.write(`${saved.result.summary.line}\nReport: ${reportPath}\n`);
  } else
    process.stdout.write(
      'Aiden\n\n  doctor\n  discover --root /path/to/project\n  login\n  report --config project.json [--format json|markdown] [--out file]\n  report --project ID\n  resume --project ID --run ID\n  validate --project ID --run ID\n  export --project ID --run ID --format markdown [--includeEstimates] --out report.md\n  integrations list\n  integrations add-linear\n  integrations add --name NAME --url URL --auth oauth|bearer|none\n  integrations connect|tools|approve|disconnect|remove --connection ID [--tools a,b]\n  sources --project ID --connection ID --source ID --historyTool TOOL --sourceArgument ARG [--label NAME]\n  estimate --project ID [--run REPORT_ID] [--refreshHistory]\n  estimation --project ID\n  estimate-overrides --project ID --config overrides.json\n  verify-url --project ID [--url URL | --clear]\n  verify --project ID [--url URL] [--out DIR]\n  calls --project ID\n  answer --project ID --call ID\n',
    );
} catch (e) {
  process.stderr.write((e instanceof Error ? e.message : 'Command failed.') + '\n');
  process.exitCode = 1;
} finally {
  terminal.close();
  client.close();
}
