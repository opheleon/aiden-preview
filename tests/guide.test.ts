import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  distinctGuideWidgets,
  type SetupFacts,
  setupProgress,
} from '../packages/contracts/src/guide.js';
import { commitBaseline } from '../packages/core/src/baseline.js';
import { Engine } from '../packages/core/src/engine.js';
import { askGuide, openGuide, readThread } from '../packages/core/src/guide.js';
import { confirmRequirements, skipSetupStep } from '../packages/core/src/guide-actions.js';
import { readSetupState } from '../packages/core/src/guide-context.js';
import { prepareAndLook, startLook } from '../packages/core/src/look.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import {
  readAppUrl,
  saveVerificationSettings,
} from '../packages/core/src/verification-settings.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

/** Synthetic setup facts for a project whose requirements exist but nothing else is set up. */
function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    baselineId: 'baseline-1',
    state: { skipped: [] },
    repositories: 0,
    url: null,
    api: false,
    phone: false,
    manual: false,
    completedChecks: 0,
    trackerLinked: false,
    ...overrides,
  };
}

void test('setup progress is derived from saved facts and resumes at the first unfinished step', () => {
  assert.equal(setupProgress(facts({ baselineId: null })).next, 'understand');
  assert.equal(setupProgress(facts()).next, 'confirm');
  const confirmed = {
    baselineId: 'baseline-1',
    requirementsConfirmedAt: '2026-10-17T09:00:00.000Z',
    skipped: [],
  };
  assert.equal(setupProgress(facts({ state: confirmed })).next, 'verify');
  // A requirement rewrite makes a new baseline, which re-opens confirmation.
  assert.equal(
    setupProgress(facts({ baselineId: 'baseline-2', state: confirmed })).next,
    'confirm',
  );
  // A URL saved in Settings completes the verification step without the chat.
  const web = setupProgress(facts({ state: confirmed, url: 'http://localhost:3000' }));
  assert.equal(web.next, 'first-check');
  assert.equal(web.steps.find((s) => s.id === 'verify')?.detail, 'Using web check.');
  const later = setupProgress(
    facts({ state: { ...confirmed, skipped: ['first-check'] }, url: 'http://localhost:3000' }),
  );
  assert.equal(later.complete, true);
  assert.equal(later.steps.find((s) => s.id === 'first-check')?.status, 'skipped');
  // Checking by hand needs no automatic first check; optional extras never block completion.
  assert.equal(setupProgress(facts({ state: confirmed, manual: true })).complete, true);
});

/** An engine over the fixture repositories, or over none when `withCode` is false. */
async function engineFor(withCode = true) {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const store = new Store(path.join(f.root, 'data'));
  const e = new Engine(store, runtime);
  e.discover = { fetch: () => Promise.reject(new Error('connection refused')) };
  const project = withCode ? f.project : { ...f.project, repositories: [] };
  return { f, runtime, store, e, project };
}

/** Poll until the condition holds, failing the test after a few seconds. */
async function until(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the fixture runs.');
}

/** Wait until no run on the project is active, so the automatic chain has settled. */
async function settle(e: Engine, projectId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const runs = await e.history(projectId);
    if (runs.length && !runs.some((r) => e.isActive(r.id))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

void test('a project with no code starts from the intent alone and skips the code check', async () => {
  const { runtime, e, project } = await engineFor(false);
  try {
    const started = await prepareAndLook(e, project, 'intent');
    await e.wait(started.runId);
    await settle(e, project.id);
    assert.ok((await e.state(project.id)).baseline, 'requirements are written without code');
    assert.ok(!runtime.calls.includes('assess'), 'no code check runs without a repository');
    assert.ok(!(await e.history(project.id)).some((r) => r.kind === 'report'));
    await assert.rejects(startLook(e, project.id, 'you'), /nothing to check yet/);
    await saveVerificationSettings(e, project.id, { url: 'http://127.0.0.1:9/' });
    const look = await startLook(e, project.id, 'you');
    const run = (await e.history(project.id)).find((r) => r.id === look.runId);
    assert.equal(run?.kind, 'verify', 'a saved web check runs against the app directly');
  } finally {
    await e.dispose();
  }
});

void test('the Guide plays back with the project runtime, applies stated setup, and keeps one thread', async (t) => {
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith(
      'http://localhost:5173',
    )
      ? Promise.resolve(new Response('Synthetic reachable app'))
      : originalFetch(input, init),
  );
  const { runtime, store, e, project } = await engineFor(false);
  try {
    const started = await prepareAndLook(e, project, 'intent');
    await e.wait(started.runId);
    await settle(e, project.id);
    runtime.guideReply = {
      reply: 'FIXTURE playback. Does this look right?',
      widgets: [
        { type: 'confirm-requirements', recommended: null, url: null, link: null },
        { type: 'confirm-requirements', recommended: null, url: null, link: null },
        // Invalid for its contract (a link card without a link), so it is dropped.
        { type: 'link', recommended: null, url: null, link: null },
      ],
      actions: [],
    };
    const kickoff = await askGuide(e, project.id, { kickoff: true });
    const guideIndex = runtime.calls.lastIndexOf('guide');
    assert.ok(guideIndex >= 0);
    assert.deepEqual(runtime.configs[guideIndex], project.runtime, 'no billing or provider change');
    const input = runtime.inputs[guideIndex] as { turn: string; requirements: { id: string }[] };
    assert.equal(input.turn, 'kickoff');
    assert.ok(input.requirements.length > 0);
    assert.deepEqual(kickoff.thread.messages.at(-1)?.widgets, [{ type: 'confirm-requirements' }]);
    assert.equal(kickoff.setup.next, 'confirm');
    // A second kickoff never repeats the playback.
    const turns = () => runtime.calls.filter((stage) => stage === 'guide').length;
    const before = turns();
    await askGuide(e, project.id, { kickoff: true });
    assert.equal(turns(), before);

    runtime.guideReply = {
      reply: 'Saved. I will check the app there.',
      widgets: [],
      actions: [
        {
          type: 'confirm-requirements',
          url: null,
          allowMutations: null,
          manual: null,
          context: null,
          step: null,
        },
        {
          type: 'save-web-check',
          url: 'http://localhost:5173',
          allowMutations: null,
          manual: null,
          context: null,
          step: null,
        },
      ],
    };
    const after = await askGuide(e, project.id, {
      text: 'Looks right. It runs at http://localhost:5173',
    });
    assert.equal((await readAppUrl(e, project.id)).url, 'http://localhost:5173/');
    assert.deepEqual(
      after.thread.messages.slice(-3).map((m) => [m.from, m.text]),
      [
        ['aiden', 'Saved. I will check the app there.'],
        ['event', 'Requirements confirmed.'],
        ['event', 'Web check saved for http://localhost:5173/.'],
      ],
    );
    assert.equal(after.setup.next, 'first-check');
    await skipSetupStep(e, project.id, 'first-check');
    assert.equal((await openGuide(e, project.id)).setup.complete, true);
    await assert.rejects(skipSetupStep(e, project.id, 'verify'), /needed before Aiden/);
    assert.equal((await readThread(store, project.id)).messages.length, 5);
  } finally {
    await e.dispose();
  }
});

void test('an unanswered message survives a failed turn, and long threads are condensed', async () => {
  const { runtime, store, e, project } = await engineFor(false);
  try {
    const started = await prepareAndLook(e, project, 'intent');
    await e.wait(started.runId);
    await settle(e, project.id);
    await confirmRequirements(e, project.id);
    runtime.guideReply = { reply: '', widgets: [], actions: [] };
    await assert.rejects(askGuide(e, project.id, { text: 'When did you last check?' }));
    const saved = await readThread(store, project.id);
    assert.deepEqual(
      saved.messages.map((m) => [m.from, m.text]),
      [['you', 'When did you last check?']],
    );
    runtime.guideReply = null;
    const retried = await askGuide(e, project.id, { retry: true });
    assert.equal(
      (runtime.inputs.at(-1) as { message: string }).message,
      'When did you last check?',
    );
    assert.equal(retried.thread.messages.at(-1)?.from, 'aiden');

    const at = new Date().toISOString();
    await atomic(path.join(store.project(project.id), 'guide.json'), {
      messages: Array.from({ length: 85 }, (_, i) => ({
        at,
        from: i % 2 ? 'aiden' : 'you',
        text: `Synthetic message ${i}`,
      })),
    });
    const compacted = await askGuide(e, project.id, { text: 'Where are we?' });
    assert.ok(runtime.calls.includes('guide-summary'));
    assert.match(compacted.thread.summary ?? '', /FIXTURE summary/);
    assert.equal(compacted.thread.messages.length, 30);
    assert.equal(compacted.thread.messages.at(-1)?.from, 'aiden');
  } finally {
    await e.dispose();
  }
});

void test('opening the Guide announces a check that finished meanwhile, once', async () => {
  const { e, project } = await engineFor(true);
  try {
    const started = await prepareAndLook(e, project, 'intent');
    await e.wait(started.runId);
    await askGuide(e, project.id, { kickoff: true });
    await until(async () =>
      (await e.history(project.id)).some((r) => r.kind === 'report' && r.status === 'completed'),
    );
    const first = await openGuide(e, project.id);
    const announced = first.thread.messages.filter((m) => /^Code check finished/.test(m.text));
    assert.equal(announced.length, 1);
    const again = await openGuide(e, project.id);
    assert.equal(again.thread.messages.length, first.thread.messages.length);
  } finally {
    await e.dispose();
  }
});

void test('setup cards stay singular across legacy web and API widgets', () => {
  assert.deepEqual(
    distinctGuideWidgets([
      { type: 'web-check' },
      { type: 'api-check' },
      { type: 'verify-options' },
      { type: 'link', link: 'help' },
      { type: 'link', link: 'slack' },
    ]),
    [{ type: 'web-check' }, { type: 'link', link: 'help' }, { type: 'link', link: 'slack' }],
  );
});

void test('an overview-only refresh preserves confirmed setup, including after reopening an older project', async () => {
  const { e, store, project } = await engineFor(false);
  try {
    const started = await e.prepare(project, { autoAccept: true });
    await e.wait(started.runId);
    await confirmRequirements(e, project.id);
    await saveVerificationSettings(e, project.id, { manual: true });
    const original = (await e.state(project.id)).baseline!;
    const confirmed = await readSetupState(store, project.id);
    const refreshed = await commitBaseline(
      store,
      project.id,
      {
        ...original.product,
        overview: 'A refreshed overview after connecting the code.',
      },
      project.context,
    );
    assert.notEqual(refreshed.id, original.id);
    assert.equal((await openGuide(e, project.id)).setup.complete, true);
    assert.equal((await openGuide(e, project.id)).setup.next, null);
    assert.deepEqual(
      await readSetupState(store, project.id),
      confirmed,
      'keep the original confirmation history',
    );
  } finally {
    await e.dispose();
  }
});

void test('changed requirements, criteria, intent, answers, or missing confirmation evidence still need review', async () => {
  const { e, store, project } = await engineFor(false);
  try {
    const started = await e.prepare(project, { autoAccept: true });
    await e.wait(started.runId);
    await confirmRequirements(e, project.id);
    await saveVerificationSettings(e, project.id, { manual: true });
    const original = (await e.state(project.id)).baseline!;
    const product = original.product;
    const changes = [
      {
        ...product,
        requirements: product.requirements.map((r, i) =>
          i ? r : { ...r, text: 'Users can search books.' },
        ),
      },
      {
        ...product,
        requirements: product.requirements.map((r, i) =>
          i
            ? r
            : {
                ...r,
                edgeCases: [
                  { id: 'E1', text: 'Empty lists are shown clearly.', origin: 'scope' as const },
                ],
              },
        ),
      },
      { ...product, milestones: ['Deliver next week.'] },
    ];
    for (const changed of changes) {
      await commitBaseline(store, project.id, changed, project.context);
      assert.equal((await openGuide(e, project.id)).setup.next, 'confirm');
    }
    await commitBaseline(store, project.id, product, 'A different goal.');
    assert.equal((await openGuide(e, project.id)).setup.next, 'confirm');
    await commitBaseline(store, project.id, product, project.context, 'changed-answers');
    assert.equal((await openGuide(e, project.id)).setup.complete, false);
    await commitBaseline(store, project.id, product, project.context);
    await rm(path.join(store.project(project.id), 'baselines', `${original.id}.json`));
    assert.equal((await openGuide(e, project.id)).setup.next, 'confirm');
  } finally {
    await e.dispose();
  }
});
