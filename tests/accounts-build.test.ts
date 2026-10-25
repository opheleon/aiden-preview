import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NewAccountTask } from '../packages/contracts/src/accounts-api.js';
import type { Baseline, Project } from '../packages/contracts/src/index.js';
import { buildRepositories, queueBuild } from '../packages/core/src/accounts/build-tasks.js';
import type { AccountsClient } from '../packages/core/src/accounts/client.js';
import type { Engine } from '../packages/core/src/engine.js';

/** One code check assessment. */
const gap = (requirementId: string, status: string) => ({
  requirementId,
  status,
  remainingWork: [`finish ${requirementId}`],
  evidence: [],
});

void test('each unfinished feature becomes one build task across every repository', async () => {
  const project = {
    id: 'p1',
    repositories: [
      { id: 'api', source: { kind: 'github', name: 'acme/calendar-api' } },
      { id: 'ui', source: { kind: 'github', name: 'acme/calendar-ui' } },
    ],
  } as unknown as Project;
  const baseline = {
    id: 'b1',
    product: {
      requirements: [
        { id: 'REQ-1', text: 'Sign in' },
        { id: 'REQ-2', text: 'Private events' },
        { id: 'REQ-3', text: 'Recurring events' },
      ],
      deliveryPlan: [
        { id: 'F-1', title: 'Sign in', requirementIds: ['REQ-1'], dependsOn: [] },
        { id: 'F-2', title: 'Private events', requirementIds: ['REQ-2'], dependsOn: ['F-1'] },
        { id: 'F-3', title: 'Recurring events', requirementIds: ['REQ-3'], dependsOn: [] },
      ],
    },
  } as unknown as Baseline;
  const engine = {
    getReport: () =>
      Promise.resolve({
        assessments: [
          gap('REQ-1', 'missing'),
          gap('REQ-2', 'partial'),
          gap('REQ-3', 'implemented'),
        ],
      }),
  } as unknown as Engine;
  const queued: NewAccountTask[] = [];
  const client = {
    enqueue: (_projectId: string, task: NewAccountTask) => Promise.resolve(queued.push(task)),
  } as unknown as AccountsClient;

  await queueBuild(engine, client, project, baseline);

  assert.deepEqual(
    queued.map((task) => [task.title, task.requirementIds, task.dedupeKey]),
    [
      ['Build: Sign in', ['REQ-1'], 'build:p1:b1:F-1'],
      ['Build: Private events', ['REQ-2'], 'build:p1:b1:F-2'],
    ],
  );
  assert.deepEqual(buildRepositories(queued[0]!.instructions!), [
    'acme/calendar-api',
    'acme/calendar-ui',
  ]);
  assert.match(queued[1]!.instructions!, /Builds on F-1, which may be built at the same time/);
});
