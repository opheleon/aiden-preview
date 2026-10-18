import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { readCalls, recordCall } from '../packages/core/src/calls.js';
import { Engine } from '../packages/core/src/engine.js';
import { askGuide, guideView } from '../packages/core/src/guide.js';
import { confirmRequirements } from '../packages/core/src/guide-actions.js';
import { readSetupState } from '../packages/core/src/guide-context.js';
import { Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

async function setup() {
  const f = await fixture();
  const runtime = new FixtureRuntime(f);
  const engine = new Engine(new Store(path.join(f.root, 'clarification-data')), runtime);
  const project = { ...f.project, repositories: [] };
  const started = await engine.prepare(project, { autoAccept: true });
  await engine.wait(started.runId);
  return { engine, project, runtime };
}

async function question(
  engine: Engine,
  projectId: string,
  text: string,
  requirementId: string | null = null,
) {
  return (
    await recordCall(
      engine.store,
      projectId,
      {
        question: text,
        requirementId,
        edgeCaseId: null,
        options: ['Organizer confirms', 'Everyone confirms'],
        blocking: true,
        assumption: 'Await an explicit choice.',
        owner: 'you',
      },
      'decision',
      null,
    )
  ).call;
}

void test('clarification reopens old setup, accepts answers in chat, and rewrites before confirmation without a check', async () => {
  const { engine, project, runtime } = await setup();
  try {
    await confirmRequirements(engine, project.id);
    const original = (await engine.state(project.id)).baseline!.id;
    const first = await question(engine, project.id, 'Who confirms the meeting?');
    const second = await question(engine, project.id, 'Who can see calendar details?');
    const view = await guideView(engine, project.id);
    assert.equal(view.setup.next, 'understand');
    assert.equal(view.clarifications?.length, 2);
    await assert.rejects(confirmRequirements(engine, project.id), /Answer the questions/);
    await assert.rejects(
      engine.verify(project.id, 'http://localhost:5180/app'),
      /No requirements are ready/,
    );
    const count = (await engine.history(project.id)).length;
    const answered = await askGuide(engine, project.id, {
      clarification: { callId: first.id, answer: 'Organizer confirms' },
    });
    assert.equal(answered.clarifications?.[0]?.id, second.id);
    assert.equal(
      (await engine.history(project.id)).length,
      count,
      'no rewrite until all questions are answered',
    );
    await assert.rejects(
      askGuide(engine, project.id, {
        clarification: { callId: first.id, answer: 'Everyone confirms' },
      }),
      /no longer waiting/,
    );
    runtime.guideReply = {
      reply: 'I will use your choice.',
      widgets: [{ type: 'run-check', recommended: null, url: null, link: null }],
      actions: [
        {
          type: 'answer-clarification',
          callId: second.id,
          url: null,
          allowMutations: null,
          manual: null,
          context: null,
          step: null,
        },
      ],
    };
    const finalAnswer = await askGuide(engine, project.id, {
      text: 'Free/busy only with each owner’s permission.',
    });
    assert.ok(finalAnswer.requirementsPending);
    assert.equal(
      finalAnswer.thread.messages.some((m) => m.widgets?.some((w) => w.type === 'run-check')),
      false,
    );
    await assert.rejects(confirmRequirements(engine, project.id), /updated with your answers/);
    const rewrite = (await engine.history(project.id))[0]!;
    await engine.wait(rewrite.id);
    assert.ok((await engine.history(project.id)).every((r) => r.kind === 'prepare'));
    const updated = await guideView(engine, project.id);
    assert.equal(updated.requirementsPending, false);
    assert.equal(updated.setup.next, 'confirm');
    assert.notEqual((await engine.state(project.id)).baseline!.id, original);
    assert.equal(
      (await readCalls(engine.store, project.id)).find((c) => c.id === second.id)?.answer,
      'Free/busy only with each owner’s permission.',
    );
    await confirmRequirements(engine, project.id);
    assert.ok((await readSetupState(engine.store, project.id)).requirementsConfirmedAt);
  } finally {
    await engine.dispose();
  }
});

void test('saved answers survive a failed rewrite and retry updates scope without running checks', async (t) => {
  const { engine, project } = await setup();
  try {
    const call = await question(engine, project.id, 'Who confirms?');
    t.mock.method(
      engine,
      'prepare',
      () => Promise.reject(new Error('Synthetic rewrite unavailable')),
      { times: 1 },
    );
    await assert.rejects(
      askGuide(engine, project.id, {
        clarification: { callId: call.id, answer: 'Organizer confirms' },
      }),
      /Synthetic rewrite unavailable/,
    );
    const view = await guideView(engine, project.id);
    assert.equal(view.clarifications?.length, 0);
    assert.equal(view.requirementsPending, true);
    await assert.rejects(confirmRequirements(engine, project.id), /updated with your answers/);
    await askGuide(engine, project.id, { retry: true });
    await engine.wait((await engine.history(project.id))[0]!.id);
    assert.equal((await guideView(engine, project.id)).setup.next, 'confirm');
    assert.ok((await engine.history(project.id)).every((r) => r.kind === 'prepare'));
  } finally {
    await engine.dispose();
  }
});

void test('a model cannot confirm or run past open questions, and asking about a choice keeps it open', async () => {
  const { engine, project, runtime } = await setup();
  try {
    await question(engine, project.id, 'Who confirms?');
    runtime.guideReply = {
      reply: 'This is a choice about who can confirm.',
      widgets: [],
      actions: [],
    };
    await askGuide(engine, project.id, { text: 'What does organizer mean?' });
    assert.equal((await guideView(engine, project.id)).clarifications?.length, 1);
    runtime.guideReply = {
      reply: 'Synthetic invalid progression.',
      widgets: [{ type: 'confirm-requirements', recommended: null, url: null, link: null }],
      actions: ['confirm-requirements', 'run-check'].map((type) => ({
        type,
        url: null,
        allowMutations: null,
        manual: null,
        context: null,
        step: null,
      })),
    };
    const view = await askGuide(engine, project.id, { text: 'Looks right, run it.' });
    assert.equal(view.setup.next, 'understand');
    assert.ok(!view.thread.messages.at(-3)?.widgets);
    assert.ok(view.thread.messages.at(-1)?.text.includes('Answer the questions'));
    assert.ok(!(await readSetupState(engine.store, project.id)).requirementsConfirmedAt);
    assert.equal((await engine.history(project.id)).length, 1);
  } finally {
    await engine.dispose();
  }
});
