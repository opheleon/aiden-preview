import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { AgentRuntime, RuntimeRequest } from '../packages/runtimes/src/index.js';
import { fixture } from './helpers.js';
import { required } from './required.js';
import { assertStrictOutputSchema } from './schema-helpers.js';
export class FixtureRuntime implements AgentRuntime {
  calls: string[] = [];
  invalid = false;
  clarification = false;
  pause = false;
  pauseEstimate = false;
  constructor(public f: Awaited<ReturnType<typeof fixture>>) {}
  async run(r: RuntimeRequest) {
    assertStrictOutputSchema(r.schema);
    const input = required(
      required(r.prompt.split('<input_data>\n')[1])?.split('\n</input_data>')[0],
    );
    if (!input) throw new Error('Fixture prompt is missing input data.');
    const data = JSON.parse(input);
    const stage = r.prompt.includes('software estimator')
      ? 'estimate-original'
      : r.prompt.includes('historical-work classifier')
        ? 'estimate-history'
        : r.prompt.includes('remaining-work estimator')
          ? 'estimate-remaining'
          : r.prompt.includes('Establish a minimal')
            ? 'understand'
            : r.prompt.includes('Find relevant code snapshots')
              ? 'discover'
              : r.prompt.includes('Assess every reviewed')
                ? 'assess'
                : 'summary';
    this.calls.push(stage);
    if (this.pause && stage === 'assess')
      await new Promise((_, reject) =>
        r.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    if (this.pauseEstimate && stage === 'estimate-original')
      await new Promise((_, reject) =>
        r.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    const client = new Client({ name: 'fixture-only', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(r.tools.url), {
        requestInit: { headers: { Authorization: `Bearer ${r.tools.token}` } },
      }) as Transport,
    );
    try {
      let value: any;
      if (stage === 'estimate-original') {
        value = {
          requirements: data.baseline.requirements.map((q: any, index: number) => ({
            requirementId: q.id,
            size: index === 0 ? 'S' : 'M',
            points: index === 0 ? 2 : 3,
            reasoning: 'FIXTURE classification from reviewed scope.',
            workType: index === 0 ? 'integration' : 'backend',
            scopeShape: 'bounded_change',
            workItems: [{ id: `${q.id}-work`, text: `Implement ${q.text}`, sharedKey: null }],
          })),
        };
      } else if (stage === 'estimate-history') {
        value = {
          issues: data.issues.map((issue: any) => ({
            id: issue.id,
            size: 'S',
            points: 2,
            reasoning: 'FIXTURE historical classification.',
            workType: 'integration',
            scopeShape: 'bounded_change',
          })),
        };
      } else if (stage === 'estimate-remaining') {
        value = {
          requirements: data.baseline.requirements.map((q: any, index: number) => ({
            requirementId: q.id,
            estimable: true,
            size: index === 0 ? 'S' : 'M',
            points: index === 0 ? 2 : 3,
            reasoning: 'FIXTURE remaining work.',
            workItems: [{ id: `${q.id}-remaining`, text: `Finish ${q.text}`, sharedKey: null }],
            unknowns: [],
          })),
        };
      } else if (stage === 'understand') {
        if (this.clarification)
          await client.callTool({
            name: 'request_clarification',
            arguments: { question: 'Fixture clarification: list existing books?' },
          });
        value = this.f.product;
      } else if (stage === 'discover')
        value = { snapshots: this.f.snapshots, warnings: ['FIXTURE: no deployment evidence'] };
      else if (stage === 'assess') {
        for (const s of this.f.snapshots)
          await client.callTool({
            name: 'repo_read',
            arguments: {
              repositoryId: s.repositoryId,
              sha: s.sha,
              path: 'app.txt',
              startLine: 1,
              endLine: 2,
            },
          });
        value = {
          assessments: [
            {
              requirementId: 'REQ-1',
              status: 'partial',
              deviation: true,
              explanation: 'Fixture: frontend requests /books, backend provides /items.',
              evidence: this.f.snapshots.map((s) => ({
                repositoryId: s.repositoryId,
                sha: s.sha,
                path: 'app.txt',
                startLine: 1,
                endLine: 2,
                explanation: 'Fixture interface evidence',
              })),
              remainingWork: ['Align FE and BE routes'],
              unknowns: [],
            },
            {
              requirementId: 'REQ-2',
              status: 'missing',
              deviation: false,
              explanation: 'Fixture: no creation implementation',
              evidence: [],
              remainingWork: ['Add book creation'],
              unknowns: [],
            },
            ...data.baseline.requirements.slice(2).map((q: any) => ({
              requirementId: q.id,
              status: 'unknown',
              deviation: false,
              explanation: 'FIXTURE: external runtime coverage unavailable',
              evidence: [],
              remainingWork: [],
              unknowns: ['No deployment evidence supplied'],
            })),
          ],
          risks: [],
          dependencies: ['FE/BE contract'],
          unknowns: [],
        };
        if (this.invalid) required(required(value.assessments[0]).evidence[0]).endLine = 1000;
      } else
        value = {
          summary: 'FIXTURE REPORT: route mismatch and missing creation. Not live model output.',
        };
      return { value, version: 'fixture-only' };
    } finally {
      await client.close();
    }
  }
}
