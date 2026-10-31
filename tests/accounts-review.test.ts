import assert from 'node:assert/strict';
import { test } from 'node:test';

import taskView from '../packages/contracts/fixtures/accounts/task-complete.json' with { type: 'json' };
import type { AccountTask } from '../packages/contracts/src/accounts-api.js';
import type { CodingJob, Project } from '../packages/contracts/src/index.js';
import { setupTaskRole } from '../packages/contracts/src/task-model.js';
import { featureRole } from '../packages/core/src/accounts/build-tasks.js';
import { AccountsClient, accountsContract } from '../packages/core/src/accounts/client.js';
import {
  buildReview,
  ciCheckName,
  pullRequestLines,
  questionTasks,
} from '../packages/core/src/accounts/review-packet.js';
import {
  runBuild,
  runnerServices,
  type TaskControls,
} from '../packages/core/src/accounts/runner.js';
import { PermanentTaskError } from '../packages/core/src/accounts/task-errors.js';
import {
  ciResult,
  runVerify,
  verifyServices,
  verifyTiming,
} from '../packages/core/src/accounts/verify-task.js';
import type { Engine } from '../packages/core/src/engine.js';
import type { RequirementVerdict, TeamCodingOutcome } from '../packages/core/src/team-coding.js';

const api = 'https://github.com/acme/api/pull/12';
const ui = 'https://github.com/acme/ui/pull/7';

/** A finished coding job; synthetic, never live agent output. */
function job(overrides: Partial<CodingJob> = {}): CodingJob {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    projectId: 'p1',
    baselineId: 'b1',
    repositoryId: 'api',
    repository: 'acme/api',
    worktree: '/tmp/work',
    branch: 'aiden/job-1',
    baseBranch: 'main',
    createdAt: '2026-10-20T15:00:00.000Z',
    updatedAt: '2026-10-20T15:00:00.000Z',
    runtime: { provider: 'claude', auth: 'subscription' },
    sessionId: 'session-1',
    status: 'awaiting_merge',
    message: 'Added sign-in to the API and the login page.',
    checks: ['pnpm test'],
    ...overrides,
  };
}

/** A leased build task from the fixture, classified as frontend work. */
function buildTask(overrides: Partial<AccountTask> = {}): AccountTask {
  return {
    ...(taskView as unknown as AccountTask),
    kind: 'build',
    status: 'leased',
    instructions: 'Feature: Sign in\nRepositories: acme/api, acme/ui',
    requirementIds: ['REQ-1', 'REQ-2'],
    role: 'fe_engineer',
    ...overrides,
  };
}

/** Controls that record progress and blocks. */
function controls(signal = new AbortController().signal) {
  const lines: string[] = [];
  const blocks: unknown[][] = [];
  const value: TaskControls = {
    signal,
    progress: (line) => lines.push(line),
    block: (...args) => {
      blocks.push(args);
      return Promise.resolve();
    },
  };
  return { value, lines, blocks };
}

const met: RequirementVerdict = {
  requirementId: 'REQ-1',
  text: 'Members sign in with email',
  status: 'implemented',
  finding: 'Implemented.',
};
const partial: RequirementVerdict = {
  requirementId: 'REQ-2',
  text: 'Expired invites are refused',
  status: 'partial',
  finding: 'Partly implemented. Still needed: refuse expired invites.',
};

void test('a build that opened PRs goes to review with CI and requirement checks instead of a review-pr task', async (t) => {
  const outcome: TeamCodingOutcome = {
    job: job({ openQuestions: [{ question: 'Which copy for the empty state?', blocking: false }] }),
    pullRequests: [api, ui],
    verdict: ['Aiden checked the pull requests: 1 of 2 requirements met.', 'REQ-1: Implemented'],
    requirements: [met, partial],
  };
  t.mock.method(runnerServices, 'runTeamCoding', () => Promise.resolve(outcome));
  const { value } = controls();
  const output = await runBuild({} as Engine, buildTask(), {} as Project, value);
  assert.equal(
    output.followUps?.some((task) => task.kind === 'review-pr'),
    false,
  );
  assert.deepEqual(output.followUps, [
    {
      actor: 'human',
      kind: 'coding-question',
      title: 'Which copy for the empty state?',
      instructions: 'Which copy for the empty state?',
      role: 'fe_engineer',
      scope: 'task',
    },
  ]);
  assert.equal(
    output.review?.summary,
    'Aiden checked the pull requests: 1 of 2 requirements met.\nREQ-1: Implemented\n\nAdded sign-in to the API and the login page.',
  );
  assert.deepEqual(output.review?.pullRequestUrls, [api, ui]);
  assert.deepEqual(output.review?.checks, [
    { name: 'CI: acme/api#12', kind: 'automated', state: 'pending', url: api },
    { name: 'CI: acme/ui#7', kind: 'automated', state: 'pending', url: ui },
    { name: 'REQ-1: Members sign in with email', kind: 'automated', state: 'passed', detail: null },
    {
      name: 'REQ-2: Expired invites are refused',
      kind: 'manual',
      state: 'pending',
      detail: 'Partly implemented. Still needed: refuse expired invites.',
    },
  ]);
});

void test('a build with no PRs asks its role a question about the task, and an empty build fails for good', async (t) => {
  const waiting = job({ status: 'needs_input', message: 'Which auth provider?' });
  t.mock.method(runnerServices, 'runTeamCoding', () =>
    Promise.resolve({ job: waiting, pullRequests: [], verdict: [], requirements: [] }),
  );
  const { value, blocks } = controls();
  const output = await runBuild({} as Engine, buildTask(), {} as Project, value);
  assert.equal(output.review, undefined);
  assert.equal(output.followUps?.[0]?.kind, 'coding-question');
  assert.equal(output.followUps?.[0]?.role, 'fe_engineer');
  assert.equal(output.followUps?.[0]?.scope, 'task');
  assert.match(output.followUps?.[0]?.instructions ?? '', /claude --resume session-1/);
  assert.deepEqual(blocks, [
    ['Coding needs a human answer', 'Which auth provider?', { role: 'fe_engineer', scope: 'task' }],
  ]);
  const unclassified = await runBuild(
    {} as Engine,
    buildTask({ role: null }),
    {} as Project,
    controls().value,
  );
  assert.equal(unclassified.followUps?.[0]?.role, undefined);
  await assert.rejects(
    runBuild({} as Engine, buildTask({ instructions: '  ' }), {} as Project, value),
    PermanentTaskError,
  );
});

void test('review packets keep every open check when they exceed the server limit', () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    ...(index % 2 ? met : partial),
    requirementId: `REQ-${index + 1}`,
  }));
  const packet = buildReview(job({ message: 'x'.repeat(9000) }), [api], [], many);
  assert.equal(packet.checks.length, 50);
  assert.equal(packet.checks.filter((check) => check.state === 'pending').length, 31);
  assert.equal(packet.summary.length, 8000);
  const unchecked = buildReview(job(), [api], [], [{ ...partial, status: null }]);
  assert.equal(unchecked.checks[1]?.kind, 'manual');
});

void test('agent questions keep their own role and scope, and fall back to the build role about the task', () => {
  assert.deepEqual(
    questionTasks(
      [
        { question: 'Move every service to the new auth?', role: 'be_engineer', scope: 'general' },
        { question: 'Confirm the label?', assigneeUserId: 'u1' },
      ],
      'fe_engineer',
    ).map((task) => [task.role, task.scope, task.assigneeUserId]),
    [
      ['be_engineer', 'general', undefined],
      ['fe_engineer', 'task', 'u1'],
    ],
  );
});

void test('verify instructions keep only GitHub PR URLs, one check name per PR', () => {
  assert.deepEqual(
    pullRequestLines(
      `${api}\nnot a url\n https://github.com/acme/ui/pull/7 \n${api}\nhttps://gitlab.com/a/b/pull/1`,
    ),
    [api, ui],
  );
  assert.equal(ciCheckName(api), 'CI: acme/api#12');
  assert.equal(ciCheckName(`${api}/files`), null);
});

void test('CI results aggregate per PR: failures and cancellations fail, running stays pending, skipped passes', () => {
  assert.deepEqual(
    ciResult(api, [
      { name: 'build', bucket: 'pass' },
      { name: 'lint', bucket: 'fail' },
      { name: 'deploy', bucket: 'cancel' },
      { name: 'e2e', bucket: 'pending' },
    ]),
    {
      name: 'CI: acme/api#12',
      kind: 'automated',
      url: api,
      state: 'failed',
      detail: 'Failed: lint, deploy',
    },
  );
  assert.equal(ciResult(api, [{ name: 'e2e', bucket: 'pending' }]).detail, 'Still running: e2e');
  const done = ciResult(api, [
    { name: 'build', bucket: 'pass' },
    { name: 'docs', bucket: 'skipping' },
  ]);
  assert.deepEqual([done.state, done.detail], ['passed', '2 checks passed']);
  assert.deepEqual(
    [ciResult(api, []).state, ciResult(api, []).detail],
    ['passed', 'No CI checks on this pull request'],
  );
  const long = ciResult(
    api,
    Array.from({ length: 80 }, (_, index) => ({ name: `job-${index}`, bucket: 'fail' as const })),
  );
  assert.equal(long.detail?.length, 500);
});

void test('a verify task waits for running CI, reporting progress, and stops when time runs low', async (t) => {
  let now = Date.parse('2026-10-20T15:00:00.000Z');
  const reads: string[][] = [];
  const answers = [
    [{ name: 'build', bucket: 'pending' as const }],
    [{ name: 'build', bucket: 'pass' as const }],
  ];
  t.mock.method(verifyServices, 'now', () => now);
  t.mock.method(verifyServices, 'wait', (ms: number) => {
    now += ms;
    return Promise.resolve();
  });
  t.mock.method(verifyServices, 'checks', (url: string) => {
    reads.push([url]);
    return Promise.resolve(reads.length <= 2 ? answers[0]! : answers[1]!);
  });
  const task = buildTask({
    kind: 'verify',
    instructions: `${api}\n${ui}`,
    execution: {
      ...(taskView as unknown as AccountTask).execution!,
      startedAt: new Date(now).toISOString(),
    },
  });
  const { value, lines } = controls();
  const output = await runVerify(task, {
    ...value,
    limits: { idleMs: 1, toolMs: 1, absoluteMs: 3_600_000 },
  });
  assert.equal(reads.length, 4);
  assert.deepEqual(
    output.checks?.map((check) => check.state),
    ['passed', 'passed'],
  );
  assert.match(lines[0]!, /CI on 2 pull requests: 0 passed, 0 failed, 2 running/);
  // Out of time: report what is still running as pending instead of waiting past the limit.
  t.mock.method(verifyServices, 'checks', () => Promise.resolve(answers[0]!));
  const late = await runVerify(task, {
    ...value,
    limits: { idleMs: 1, toolMs: 1, absoluteMs: verifyTiming.reserveMs + 1000 },
  });
  assert.deepEqual(
    late.checks?.map((check) => check.state),
    ['pending', 'pending'],
  );
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(runVerify(task, controls(stopped.signal).value), { name: 'AbortError' });
});

void test('features take the plan role, else a documented guess; setup steps follow PM and Dev', () => {
  assert.equal(featureRole({ title: 'Edit books', role: 'product_manager' }), 'product_manager');
  assert.equal(
    featureRole({ title: 'Edit books', role: null, outcome: 'A new page to edit' }),
    'fe_engineer',
  );
  assert.equal(featureRole({ title: 'Shared auth', kind: 'platform' }), 'be_engineer');
  assert.equal(featureRole({ title: 'Sync invoices to Stripe' }), 'be_engineer');
  assert.equal(setupTaskRole('confirm'), 'product_manager');
  assert.equal(setupTaskRole('code'), 'be_engineer');
  assert.equal(setupTaskRole('understand'), 'product_manager');
});

void test('the client sends reviews, manual checks, permanent failures, and review packets', async () => {
  const sent: { url: string; body: unknown; contract: string | undefined }[] = [];
  const http = ((url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    sent.push({ url, body: JSON.parse(init.body as string), contract: headers['aiden-contract'] });
    return Promise.resolve(new Response(JSON.stringify(taskView), { status: 200 }));
  }) as typeof fetch;
  const client = new AccountsClient('https://api.example.com', () => Promise.resolve('t'), http);
  const reviewed = await client.review('t 1', 'changes', 'Handle expired invites');
  assert.deepEqual(reviewed.checks, []);
  await client.markCheck('t1', 'c/2', true, '');
  await client.fail('t1', {
    deviceId: 'd',
    attemptId: 'a',
    error: 'No PR',
    outcome: null,
    permanent: true,
  });
  await client.complete('t1', {
    deviceId: 'd',
    attemptId: 'a',
    result: null,
    followUps: [],
    outcome: null,
    review: { summary: 's', pullRequestUrls: [api], checks: [] },
  });
  assert.deepEqual(
    sent.map((call) => call.url.replace('https://api.example.com/api/v1', '')),
    ['/tasks/t%201/review', '/tasks/t1/checks/c%2F2', '/tasks/t1/fail', '/tasks/t1/complete'],
  );
  // Every request asks for the review-and-verify shape; without it the server answers as for older apps.
  assert.deepEqual(
    sent.map((call) => call.contract),
    sent.map(() => String(accountsContract)),
  );
  assert.deepEqual(sent[0]!.body, { decision: 'changes', note: 'Handle expired invites' });
  assert.deepEqual(sent[1]!.body, { passed: true, note: '' });
  assert.equal((sent[2]!.body as { permanent: boolean }).permanent, true);
  assert.deepEqual((sent[3]!.body as { review: unknown }).review, {
    summary: 's',
    pullRequestUrls: [api],
    checks: [],
  });
});
