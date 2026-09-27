import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ComplexityOutputSchema,
  outputSchemaFor,
  RemainingOutputSchema,
} from '../packages/contracts/src/index.js';
import { publicError, Runtimes } from '../packages/runtimes/src/index.js';
import { ToolBroker } from '../packages/tools/src/broker.js';
import { serveTools } from '../packages/tools/src/mcp.js';
import { fixture } from '../tests/helpers.js';

// Live provider verification with synthetic inputs only. This does not publish a report.
const f = await fixture();
const workspace = path.join(f.root, 'schema-smoke');
await mkdir(workspace);
const runtime = new Runtimes(path.join(workspace, 'providers'));
const broker = new ToolBroker(
  f.project,
  workspace,
  path.join(workspace, 'reads.json'),
  () => Promise.resolve('This is a synthetic schema compatibility test.'),
  () => {},
);
const tools = await serveTools(broker);
try {
  for (const [stage, schema] of [
    ['estimate-original', ComplexityOutputSchema],
    ['estimate-remaining', RemainingOutputSchema],
  ] as const) {
    const instructions = await readFile(
      new URL(`../workflows/v1/${stage}.md`, import.meta.url),
      'utf8',
    );
    const input = {
      baseline: {
        overview: 'Synthetic settings screen',
        milestones: [],
        requirements: [
          { id: 'REQ-1', text: 'Change the existing settings heading to Preferences.' },
        ],
      },
      ...(stage === 'estimate-remaining'
        ? {
            report: {
              assessments: [
                {
                  requirementId: 'REQ-1',
                  status: 'missing',
                  deviation: false,
                  explanation: 'Synthetic assessment: the heading has not been changed.',
                  remainingWork: ['Change the heading'],
                  unknowns: [],
                  evidence: [],
                },
              ],
            },
          }
        : {}),
    };
    const output = outputSchemaFor(schema);
    console.log(
      JSON.stringify({
        status: 'running',
        provider: 'codex',
        auth: 'subscription',
        stage,
        syntheticInputs: true,
      }),
    );
    const result = await runtime.run({
      config: { provider: 'codex', auth: 'subscription' },
      prompt: `${instructions}\n<input_data>\n${JSON.stringify(input)}\n</input_data>\n<verification_context>This is a synthetic schema test. Classify only the supplied standalone label change, which has no shared work. Proceed directly from the supplied input.</verification_context>\nReturn ONLY JSON matching this schema:\n${JSON.stringify(output)}`,
      schema: output,
      cwd: workspace,
      tools,
      signal: AbortSignal.timeout(120000),
      progress: () => {},
    });
    const parsed = schema.parse(result.value);
    assert.deepEqual(
      parsed.requirements.map((r) => r.requirementId),
      ['REQ-1'],
    );
    const requirement = parsed.requirements[0];
    assert.ok(requirement);
    assert.ok(requirement.workItems.length > 0);
    assert.ok(requirement.workItems.every((item) => item.sharedKey === null));
    console.log(
      JSON.stringify({
        status: 'passed',
        stage,
        liveProvider: true,
        syntheticInputs: true,
        nullSharedKeysAccepted: true,
        version: result.version,
        model: result.model,
      }),
    );
  }
} catch (error) {
  console.error(publicError(error));
  process.exitCode = 1;
} finally {
  await tools.close();
  runtime.dispose();
}
