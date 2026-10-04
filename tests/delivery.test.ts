import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { CodingJob, RuntimeConfig } from '../packages/contracts/src/index.js';
import {
  betaSettings,
  deliveryServices,
  reconcileDelivery,
  saveBetaSettings,
} from '../packages/core/src/beta-delivery.js';
import { recordCall } from '../packages/core/src/calls.js';
import {
  cancelCoding,
  codingActive,
  codingJobs,
  codingServices,
  jobFile,
  startCodingJob,
} from '../packages/core/src/coding-jobs.js';
import { Engine } from '../packages/core/src/engine.js';
import { decideProject } from '../packages/core/src/project-lifecycle.js';
import { atomic, Store, uid } from '../packages/core/src/storage.js';
import {
  saveAppUrl,
  saveVerificationSettings,
} from '../packages/core/src/verification-settings.js';
import {
  deliveryGitServices,
  findJobPullRequest,
  readPullRequest,
} from '../packages/tools/src/delivery-git.js';
import { betaUrl, deployedRevision } from '../packages/verification/src/beta.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const sha = 'a'.repeat(40);
const deployed = 'b'.repeat(40);
async function setup() {
  const f = await fixture();
  const engine = new Engine(new Store(path.join(f.root, 'data')), new FixtureRuntime(f));
  const p = await engine.prepare(f.project);
  await engine.wait(p.runId);
  const prepared = (await engine.history(f.project.id)).find((r) => r.id === p.runId)!;
  assert.equal(prepared.status, 'review', prepared.error);
  const baseline = await engine.approve(f.project.id, p.runId, f.product);
  await engine.updateRuntime(f.project.id, {
    provider: 'claude',
    auth: 'subscription',
    model: 'opus',
    effort: 'high',
  });
  await saveBetaSettings(engine, f.project.id, { codingAgentEnabled: true });
  const id = uid();
  const job: CodingJob = {
    id,
    projectId: f.project.id,
    baselineId: baseline.id,
    repositoryId: f.project.repositories[0]!.id,
    repository: 'fixture/repo',
    branch: `aiden/job-${id}`,
    baseBranch: 'main',
    worktree: path.join(f.root, 'worktree'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runtime: { provider: 'claude', auth: 'subscription' },
    status: 'awaiting_merge',
    message: 'Synthetic fixture',
    checks: [],
    pullRequestUrl: 'https://github.com/fixture/repo/pull/1',
  };
  return {
    f,
    engine,
    job,
    close: async () => {
      await engine.dispose();
      await rm(f.root, { recursive: true, force: true });
    },
  };
}
function pr(job: CodingJob, state: 'OPEN' | 'CLOSED' | 'MERGED' = 'MERGED') {
  return {
    url: job.pullRequestUrl!,
    state,
    headRefName: job.branch,
    baseRefName: 'main',
    headRepository: { name: 'repo' },
    headRepositoryOwner: { login: 'fixture' },
    mergeCommit: state === 'MERGED' ? { oid: sha } : null,
    reviewDecision: 'APPROVED',
    statusCheckRollup: [],
  };
}
async function waitJob(engine: Engine, projectId: string): Promise<CodingJob> {
  for (let i = 0; i < 100; i++) {
    const job = (await codingJobs(engine, projectId))[0];
    if (job && !codingActive(engine, job.id)) {
      // The job may finish while the first read is in flight. Read its final saved state only
      // after observing it inactive, so a pre-validation snapshot cannot look settled.
      const finished = (await codingJobs(engine, projectId)).find((saved) => saved.id === job.id);
      if (finished && finished.status !== 'running') return finished;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not settle');
}

void test('external completion persists a job and PR without running any Aiden verification or local test commands', async (t) => {
  const { f, engine, job, close } = await setup();
  try {
    assert.deepEqual(await codingJobs(engine, f.project.id), []);
    t.mock.method(codingServices, 'worktree', async () => {
      await Promise.resolve();
      return {
        repository: job.repository,
        baseBranch: 'main',
      };
    });
    t.mock.method(codingServices, 'readPullRequest', async () => {
      await Promise.resolve();
      throw new Error('Temporary GitHub response failure');
    });
    const calls: RuntimeConfig[] = [];
    engine.runtime = {
      run: async (request) => {
        await Promise.resolve();
        calls.push(request.config);
        assert.ok(request.coding);
        assert.match(request.prompt, /you own local tests/);
        return {
          value: {
            outcome: 'ready',
            summary: 'Ready for review',
            pullRequestUrl: job.pullRequestUrl,
            localChecks: ['fixture check passed'],
          },
          version: 'fixture',
          model: 'claude-opus-5-5',
        };
      },
    };
    t.mock.method(engine, 'verify', () => {
      throw new Error('Must not verify before merge');
    });
    const started = await startCodingJob(
      engine,
      f.project.id,
      job.repositoryId,
      'Implement the test change',
    );
    const finished = await waitJob(engine, f.project.id);
    assert.equal(finished.status, 'awaiting_merge');
    assert.equal(finished.id, started.id);
    assert.deepEqual(finished.checks, ['fixture check passed']);
    assert.equal(finished.pullRequestUrl, job.pullRequestUrl);
    assert.match(finished.error!, /could not validate/);
    t.mock.method(deliveryServices, 'readPullRequest', () => Promise.resolve(pr(job, 'OPEN')));
    assert.equal((await reconcileDelivery(engine, f.project.id))[0]?.error, undefined);
    assert.equal(calls[0]?.effort, 'high');
    await assert.rejects(
      startCodingJob(engine, f.project.id, job.repositoryId, 'Duplicate'),
      /unfinished/,
    );
    finished.status = 'needs_input';
    await atomic(jobFile(engine, f.project.id, finished.id), finished);
    engine.runtime = {
      run: async () => {
        await Promise.resolve();
        throw new Error('fixture failure');
      },
    };
    await startCodingJob(engine, f.project.id, job.repositoryId, 'Another explicit task');
    assert.equal((await waitJob(engine, f.project.id)).status, 'failed');
    await assert.rejects(
      startCodingJob(engine, f.project.id, 'unknown', 'Wrong repo'),
      /Choose a repository/,
    );
  } finally {
    await close();
  }
});

void test('a completed agent with a legacy tracking failure recovers its PR without rerunning code', async (t) => {
  const { f, engine, job, close } = await setup();
  try {
    job.status = 'failed';
    job.model = 'claude-opus-5-5';
    delete job.pullRequestUrl;
    await atomic(jobFile(engine, f.project.id, job.id), job);
    const url = 'https://github.com/fixture/repo/pull/1';
    t.mock.method(deliveryServices, 'findJobPullRequest', () => Promise.resolve(url));
    t.mock.method(deliveryServices, 'readPullRequest', () =>
      Promise.resolve(pr({ ...job, pullRequestUrl: url }, 'OPEN')),
    );
    const recovered = (await reconcileDelivery(engine, f.project.id))[0]!;
    assert.equal(recovered.status, 'awaiting_merge');
    assert.equal(recovered.pullRequestUrl, url);
  } finally {
    await close();
  }
});

void test('recovery finds exactly one PR for the job and independently validates its identity', async (t) => {
  const response = {
    url: 'https://github.com/fixture/repo/pull/1',
    state: 'OPEN',
    headRefName: 'aiden/job',
    baseRefName: 'main',
    headRepository: { name: 'repo' },
    headRepositoryOwner: { login: 'fixture' },
    mergeCommit: null,
    reviewDecision: '',
    statusCheckRollup: [],
  };
  let matches: { url: string }[] = [];
  t.mock.method(deliveryGitServices, 'github', (args: string[]) => {
    if (args[1] === 'list') {
      assert.ok(args.includes('aiden/job'));
      assert.ok(args.includes('main'));
      return Promise.resolve(matches);
    }
    return Promise.resolve(response);
  });
  assert.equal(await findJobPullRequest('fixture/repo', 'aiden/job', 'main'), null);
  matches = [{ url: response.url }];
  assert.equal(await findJobPullRequest('fixture/repo', 'aiden/job', 'main'), response.url);
  response.headRepositoryOwner.login = 'fork';
  await assert.rejects(findJobPullRequest('fixture/repo', 'aiden/job', 'main'), /does not match/);
});

void test('external cancellation and crash recovery preserve work and never relaunch automatically', async (t) => {
  const { f, engine, job, close } = await setup();
  try {
    t.mock.method(codingServices, 'worktree', async () => {
      await Promise.resolve();
      return {
        repository: job.repository,
        baseBranch: 'main',
      };
    });
    engine.runtime = {
      run: (r) =>
        new Promise((_, reject) =>
          r.signal.addEventListener('abort', () => reject(new Error('stopped'))),
        ),
    };
    const started = await startCodingJob(
      engine,
      f.project.id,
      job.repositoryId,
      'Held synthetic job',
    );
    assert.equal(codingActive(engine, started.id), true);
    await assert.rejects(
      decideProject(engine, f.project.id, {
        action: 'closed',
        note: 'Trying to close active work.',
      }),
      /Stop the active coding job/,
    );
    assert.equal((await reconcileDelivery(engine, f.project.id))[0]?.status, 'running');
    await cancelCoding(engine, started.id);
    assert.equal((await codingJobs(engine, f.project.id))[0]?.status, 'interrupted');
    await assert.rejects(cancelCoding(engine, started.id), /not running/);
    job.status = 'running';
    await atomic(jobFile(engine, f.project.id, job.id), job);
    assert.ok(
      (await reconcileDelivery(engine, f.project.id)).some(
        (j) => j.id === job.id && j.status === 'interrupted',
      ),
    );
  } finally {
    await close();
  }
});

void test('merge and deployed revision gate scheduled beta checks; concurrent polling and restarts do not duplicate them', async (t) => {
  const { f, engine, job, close } = await setup();
  try {
    await atomic(jobFile(engine, f.project.id, job.id), job);
    let state: 'OPEN' | 'CLOSED' | 'MERGED' = 'OPEN';
    let deployedSha = sha;
    t.mock.method(deliveryServices, 'readPullRequest', async () => {
      await Promise.resolve();
      return pr(job, state);
    });
    t.mock.method(deliveryServices, 'deployedRevision', async () => {
      await Promise.resolve();
      return deployedSha;
    });
    t.mock.method(deliveryServices, 'github', async () => {
      await Promise.resolve();
      return { status: 'behind' };
    });
    assert.equal((await reconcileDelivery(engine, f.project.id))[0]?.status, 'awaiting_merge');
    state = 'MERGED';
    assert.equal((await reconcileDelivery(engine, f.project.id))[0]?.status, 'awaiting_deployment');
    assert.equal((await betaSettings(engine, f.project.id)).enabled, false);
    await saveAppUrl(engine, f.project.id, 'http://localhost:3000');
    await assert.rejects(saveBetaSettings(engine, f.project.id, { enabled: true }), /HTTPS beta/);
    await saveAppUrl(engine, f.project.id, 'https://beta.example.com');
    await saveVerificationSettings(engine, f.project.id, {
      api: { url: 'http://localhost:8000', allowMutations: false },
    });
    await assert.rejects(
      saveBetaSettings(engine, f.project.id, {
        enabled: true,
        revisionUrl: 'https://beta.example.com/version',
      }),
      /HTTPS beta/,
    );
    await saveVerificationSettings(engine, f.project.id, { api: null });
    await assert.rejects(
      saveBetaSettings(engine, f.project.id, {
        enabled: true,
        revisionUrl: 'https://other.example.com/version',
      }),
      /same origin/,
    );
    await saveBetaSettings(engine, f.project.id, {
      enabled: true,
      intervalMinutes: 60,
      revisionUrl: 'https://beta.example.com/version',
    });
    let launches = 0;
    t.mock.method(
      engine,
      'verify',
      async (...[, url, , delivery]: Parameters<Engine['verify']>) => {
        await Promise.resolve();
        launches++;
        assert.equal(url, 'https://beta.example.com/');
        assert.equal(delivery?.beta?.revision, sha);
        return { runId: delivery.runId! };
      },
    );
    deployedSha = deployed;
    assert.equal((await reconcileDelivery(engine, f.project.id))[0]?.status, 'awaiting_deployment');
    assert.equal(launches, 0);
    deployedSha = sha;
    await saveVerificationSettings(engine, f.project.id, {
      api: { url: 'https://other.example.com/api', allowMutations: false },
    });
    assert.match((await reconcileDelivery(engine, f.project.id))[0]!.error!, /same origin/);
    assert.equal(launches, 0);
    await saveVerificationSettings(engine, f.project.id, { api: null });
    const results = await Promise.all([
      reconcileDelivery(engine, f.project.id),
      reconcileDelivery(engine, f.project.id),
    ]);
    assert.equal(launches, 1);
    assert.equal(results[0]?.[0]?.status, 'verifying');
    const runId = results[0][0].verificationRunId!;
    const out = path.join(engine.store.run(f.project.id, runId), 'verification');
    await mkdir(out, { recursive: true });
    await atomic(path.join(out, 'results.json'), {
      partial: false,
      runId,
      projectId: job.projectId,
      baselineId: job.baselineId,
      environment: 'beta',
      deploymentRevision: sha,
      summary: { total: 1, verified: 1, failed: 0, unverified: 0, line: '1 verified' },
    });
    const now = new Date();
    const checked = (await reconcileDelivery(engine, f.project.id, now))[0]!;
    assert.equal(checked.status, 'verified');
    await reconcileDelivery(engine, f.project.id, new Date(now.getTime() + 30000));
    assert.equal(launches, 1);
    await reconcileDelivery(engine, f.project.id, new Date(now.getTime() + 3600001));
    assert.equal(launches, 2);
    await reconcileDelivery(engine, f.project.id); // the new run has no result, so it stays unverified
    assert.equal((await codingJobs(engine, f.project.id))[0]?.status, 'unverified');
    const saved = (await codingJobs(engine, f.project.id))[0]!;
    saved.baselineId = 'old';
    await atomic(jobFile(engine, f.project.id, job.id), saved);
    assert.equal((await reconcileDelivery(engine, f.project.id))[0]?.status, 'stale');
  } finally {
    await close();
  }
});

void test('beta revision reads reject localhost, redirects, malformed SHA and oversized responses', async (t) => {
  assert.throws(() => betaUrl('https://localhost/version'), /beta deployment/);
  assert.throws(() => betaUrl('https://user:pass@beta.example.com'), /beta deployment/);
  let response = new Response(JSON.stringify({ commit: sha }));
  t.mock.method(globalThis, 'fetch', async (...[, options]: Parameters<typeof fetch>) => {
    await Promise.resolve();
    assert.equal(options?.redirect, 'error');
    return response;
  });
  assert.equal(await deployedRevision('https://beta.example.com/version'), sha);
  response = new Response('{"commit":"short"}');
  await assert.rejects(deployedRevision('https://beta.example.com/version'), /full commit/);
  response = new Response('x'.repeat(5000));
  await assert.rejects(deployedRevision('https://beta.example.com/version'), /too large/);
  response = new Response('', { status: 503 });
  await assert.rejects(deployedRevision('https://beta.example.com/version'), /unavailable/);
});

void test('agent-reported PR identity must match the trusted repository, work branch and merge target', async (t) => {
  let calls = 0;
  const response = {
    url: 'https://github.com/fixture/repo/pull/1',
    state: 'OPEN',
    headRefName: 'aiden/job',
    baseRefName: 'main',
    headRepository: { name: 'repo' },
    headRepositoryOwner: { login: 'fixture' },
    mergeCommit: null,
    reviewDecision: null,
    statusCheckRollup: [],
  };
  t.mock.method(deliveryGitServices, 'github', () => {
    calls++;
    return Promise.resolve(response);
  });
  await assert.rejects(
    readPullRequest('fixture/repo', 'https://github.com/foreign/repo/pull/1', 'aiden/job', 'main'),
    /does not belong/,
  );
  await assert.rejects(
    readPullRequest('fixture/repo', 'https://example.com/fixture/repo/pull/1', 'aiden/job', 'main'),
    /does not belong/,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await readPullRequest('fixture/repo', response.url, 'aiden/job', 'main')).state,
    'OPEN',
  );
  await assert.rejects(
    readPullRequest('fixture/repo', response.url, 'different', 'main'),
    /does not match/,
  );
  await assert.rejects(
    readPullRequest('fixture/repo', response.url, 'aiden/job', 'beta'),
    /does not match/,
  );
  response.headRepositoryOwner.login = 'fork';
  await assert.rejects(
    readPullRequest('fixture/repo', response.url, 'aiden/job', 'main'),
    /does not match/,
  );
});

void test('coding beta opt-in is enforced before worktree creation and blockers still prevent dispatch', async (t) => {
  const { f, engine, job, close } = await setup();
  try {
    await saveBetaSettings(engine, f.project.id, { codingAgentEnabled: false });
    let worktrees = 0;
    t.mock.method(codingServices, 'worktree', async () => {
      await Promise.resolve();
      worktrees++;
      throw new Error('Should not create a worktree');
    });
    await assert.rejects(
      startCodingJob(engine, f.project.id, job.repositoryId, 'Build it'),
      /disabled/,
    );
    await saveBetaSettings(engine, f.project.id, { codingAgentEnabled: true });
    await recordCall(
      engine.store,
      f.project.id,
      {
        requirementId: 'REQ-1',
        edgeCaseId: null,
        question: 'What should this do?',
        assumption: 'Implementation waits for agreed behavior.',
        options: [],
        owner: 'you',
        blocking: true,
      },
      'decision',
      null,
    );
    await assert.rejects(
      startCodingJob(engine, f.project.id, job.repositoryId, 'Build it'),
      /blocking scope/,
    );
    assert.equal(worktrees, 0);
    assert.deepEqual(await codingJobs(engine, f.project.id), []);
  } finally {
    await close();
  }
});

void test('closed projects retain delivery jobs without polling GitHub or starting beta verification', async (t) => {
  const { f, engine, job, close } = await setup();
  try {
    await atomic(jobFile(engine, f.project.id, job.id), job);
    const read = t.mock.method(deliveryServices, 'readPullRequest', () =>
      Promise.resolve(pr(job, 'OPEN')),
    );
    await decideProject(engine, f.project.id, { action: 'closed', note: 'Pause delivery.' });
    assert.deepEqual(await reconcileDelivery(engine, f.project.id), [job]);
    assert.equal(read.mock.callCount(), 0);
    await decideProject(engine, f.project.id, { action: 'reopened', note: 'Resume delivery.' });
    await reconcileDelivery(engine, f.project.id);
    assert.equal(read.mock.callCount(), 1);
  } finally {
    await close();
  }
});
