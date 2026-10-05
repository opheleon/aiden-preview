import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { Call, Product } from '../packages/contracts/src/index.js';
import { applyBlockers, requireDefinedScope } from '../packages/core/src/blockers.js';
import {
  answerCall,
  readCalls,
  recordCall,
  replaceOpenDecisions,
} from '../packages/core/src/calls.js';
import { Engine } from '../packages/core/src/engine.js';
import { prepareAndLook } from '../packages/core/src/look.js';
import { Store } from '../packages/core/src/storage.js';
import {
  blockerSources,
  requirementBlockers,
  waitingReason,
} from '../packages/reporting/src/blockers.js';
import { deliveryTickets } from '../packages/reporting/src/tickets.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const product: Product = {
  overview: 'Synthetic project',
  milestones: [],
  requirements: [1, 2, 3, 4].map((n) => ({ id: `REQ-${n}`, text: `Behavior ${n}` })),
  deliveryPlan: [1, 2, 3, 4].map((n) => ({
    id: `F-${n}`,
    title: `Feature ${n}`,
    outcome: `Outcome ${n}`,
    kind: 'feature',
    rationale: 'Synthetic feature',
    requirementIds: [`REQ-${n}`],
    dependsOn: n === 2 || n === 3 ? [`F-${n - 1}`] : [],
  })),
};
const call: Call = {
  id: 'decision',
  kind: 'decision',
  status: 'open',
  requirementId: 'REQ-1',
  edgeCaseId: null,
  question: 'What isolation behavior is required?',
  assumption: 'Provisioning waits for the isolation policy.',
  options: [],
  owner: 'you',
  askedAt: new Date().toISOString(),
  answer: null,
  answeredAt: null,
  runId: null,
};

void test('legacy blockers propagate through dependencies, while independent tickets retain acceptance criteria', () => {
  const blocked = requirementBlockers(product, [call]);
  assert.deepEqual(
    [...blocked].filter(([, c]) => c.length).map(([id]) => id),
    ['REQ-1', 'REQ-2', 'REQ-3'],
  );
  const tickets = deliveryTickets(product, undefined, [call]);
  assert.deepEqual(
    tickets.map((t) => t.blocked),
    [true, true, true, false],
  );
  assert.match(tickets[0]!.markdown, /## Decision needed/);
  assert.match(tickets[0]!.markdown, /## Draft scope \(not acceptance criteria\)/);
  assert.match(tickets[1]!.markdown, /Dependencies: F-1/);
  assert.match(tickets[1]!.markdown, /Owner: you/);
  assert.match(tickets[1]!.markdown, /## Waiting on a prerequisite decision/);
  assert.match(tickets[1]!.markdown, /F-1 Feature 1 needs a decision first/);
  assert.doesNotMatch(tickets[1]!.markdown, /## Decision needed|## Known remaining work/);
  assert.doesNotMatch(tickets[1]!.markdown, /Provisioning waits/, 'upstream assumption omitted');
  assert.match(tickets[1]!.markdown, /## Acceptance criteria/);
  assert.match(tickets[3]!.markdown, /## Acceptance criteria/);
  for (const variant of [
    { ...call, requirementId: null },
    { ...call, requirementId: 'REQ-99' },
  ])
    assert.equal(
      [...requirementBlockers(product, [variant]).values()].filter((c) => c.length).length,
      4,
    );
  assert.ok(
    [...requirementBlockers(product, [{ ...call, blocking: false }]).values()].every(
      (c) => !c.length,
    ),
  );
  assert.ok(
    [...requirementBlockers(product, [{ ...call, status: 'answered' }]).values()].every(
      (c) => !c.length,
    ),
  );
});

void test('blocker sources separate a requirement’s own decisions from prerequisite waits', () => {
  const sources = blockerSources(product, [call]);
  assert.deepEqual(
    [...sources].map(([id, s]) => [id, s.direct.length, s.inherited.length]),
    [
      ['REQ-1', 1, 0],
      ['REQ-2', 0, 1],
      ['REQ-3', 0, 1],
      ['REQ-4', 0, 0],
    ],
  );
  const projectWide = blockerSources(product, [{ ...call, requirementId: null }]);
  assert.ok([...projectWide.values()].every((s) => s.direct.length === 1 && !s.inherited.length));
  assert.equal(
    waitingReason(product, [call]),
    'F-1 Feature 1 needs a decision first: What isolation behavior is required? Owner: you.',
  );
  assert.match(
    waitingReason({ ...product, deliveryPlan: [] }, [call]),
    /^A prerequisite feature needs a decision first/,
  );
});

void test('persisted blockers survive omission, suppress completion and sizing, and release only after a decision', async () => {
  const f = await fixture();
  const store = new Store(path.join(f.root, 'data'));
  try {
    const { call: saved } = await recordCall(store, f.project.id, call, 'decision', 'before');
    await replaceOpenDecisions(store, f.project.id, [], 'rewrite');
    assert.equal((await readCalls(store, f.project.id))[0]?.status, 'open');
    await assert.rejects(requireDefinedScope(store, f.project.id, product), /Resolve blocking/);
    const findings = await applyBlockers(store, f.project.id, product, {
      assessments: product.requirements.map((r) => ({
        requirementId: r.id,
        status: 'implemented',
        deviation: false,
        evidence: [],
        explanation: 'Unsupported synthetic claim',
        remainingWork: ['Invented implementation'],
        unknowns: [],
      })),
      risks: [],
      dependencies: [],
      unknowns: [],
    });
    assert.equal(findings.assessments[0]?.status, 'unknown');
    assert.deepEqual(findings.assessments[0]?.remainingWork, []);
    // A dependent keeps its code evidence and status but loses executable steps while it waits.
    assert.equal(findings.assessments[1]?.status, 'implemented');
    assert.deepEqual(findings.assessments[1]?.remainingWork, []);
    assert.match(findings.assessments[1]?.unknowns.at(-1) ?? '', /^Waiting: F-1 Feature 1 needs/);
    assert.equal(findings.assessments[3]?.status, 'implemented');
    assert.deepEqual(findings.assessments[3]?.remainingWork, ['Invented implementation']);
    const partial = await applyBlockers(store, f.project.id, product, {
      assessments: [],
      risks: [],
      dependencies: [],
      unknowns: [],
    });
    assert.match(partial.assessments[1]!.explanation, /^Waiting:/);
    assert.match(partial.assessments[3]!.explanation, /Not assessed in this check/);
    await answerCall(store, f.project.id, saved.id, 'Isolate each tenant.');
    await requireDefinedScope(store, f.project.id, product);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('automatic planning assesses defined scope, saves blocked tickets, and skips total sizing', async () => {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  runtime.understanding = {
    ...product,
    repositories: [],
    requirements: product.requirements.map((r) => ({ ...r, edgeCases: [] })),
    calls: [
      {
        requirementId: call.requirementId,
        edgeCaseId: null,
        question: call.question,
        assumption: call.assumption,
        options: [],
        owner: 'you',
        blocking: true,
      },
    ],
  };
  const engine = new Engine(new Store(path.join(f.root, 'data')), runtime);
  try {
    await prepareAndLook(engine, f.project, 'intent');
    for (let i = 0; i < 300; i++) {
      const runs = await engine.history(f.project.id);
      const report = runs.find((r) => r.kind === 'report');
      if (report && !engine.isActive(report.id)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const runs = await engine.history(f.project.id);
    const reportRun = runs.find((r) => r.kind === 'report')!;
    assert.equal(reportRun.status, 'completed', reportRun.error);
    const input = runtime.inputs[runtime.calls.indexOf('assess')] as {
      baseline: Product;
      openDecisions: { question: string; requirementId: string | null; blocking: boolean }[];
    };
    // Only the undefined requirement is withheld; prerequisite waits are still assessed.
    assert.deepEqual(
      input.baseline.requirements.map((r) => r.id),
      ['REQ-2', 'REQ-3', 'REQ-4'],
    );
    assert.deepEqual(input.openDecisions, [
      {
        blocking: true,
        question: call.question,
        assumption: call.assumption,
        requirementId: 'REQ-1',
        edgeCaseId: null,
      },
    ]);
    assert.ok(!runtime.calls.includes('estimate-original'));
    const report = await engine.getReport(f.project.id, reportRun.id);
    assert.match(report.assessments[0]!.explanation, /Blocked/);
    const tickets = await readFile(
      path.join(engine.store.run(f.project.id, reportRun.id), 'tickets.md'),
      'utf8',
    );
    assert.match(tickets, /Blocked, draft scope/);
    assert.match(tickets, /F-4: Feature 4/);
  } finally {
    await engine.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
});
