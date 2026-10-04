import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { z } from 'zod/v3';

import type { Project, RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import { answerCall, recordCall } from '../packages/core/src/calls.js';
import { Engine } from '../packages/core/src/engine.js';
import { createModelStage } from '../packages/core/src/model-stage.js';
import { atomic, json, optionalJson, Store } from '../packages/core/src/storage.js';
import {
  ArtifactFormatError,
  type RuntimeRequest,
  type RuntimeResult,
} from '../packages/runtimes/src/index.js';

async function stageFixture(
  handler: (request: RuntimeRequest, attempt: number) => Promise<RuntimeResult>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-stage-'));
  const project: Project = {
    id: 'fixture',
    name: 'Synthetic project',
    context: 'Synthetic intent',
    repositories: [{ id: 'repo', path: root, notes: '' }],
    runtime: { provider: 'codex', auth: 'subscription' },
  };
  const run: RunManifest = {
    id: 'run',
    projectId: project.id,
    project,
    kind: 'prepare',
    stage: 'understand',
    status: 'running',
    createdAt: new Date().toISOString(),
  };
  let calls = 0;
  const events: RunEvent[] = [];
  const runtime = { run: (request: RuntimeRequest) => handler(request, ++calls) };
  const engine = new Engine(new Store(root), runtime, (event) => events.push(event));
  const controller = new AbortController();
  const options = {
    context: {
      store: engine.store,
      runtime,
      emit: engine.emit,
      integrations: engine.integrations,
      getReport: engine.getReport.bind(engine),
      getEstimate: engine.getEstimate.bind(engine),
    },
    run,
    signal: controller.signal,
    dir: root,
    workspace: root,
    tools: { url: 'http://127.0.0.1:1/mcp', token: 'synthetic', close: () => Promise.resolve() },
  };
  return {
    root,
    run,
    events,
    controller,
    options,
    calls: () => calls,
    close: async () => {
      await engine.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const schema = z.object({ accepted: z.literal(true) });
void test('stage corrects only invalid output and resumes a validated checkpoint without another provider call', async () => {
  const f = await stageFixture(async (request, attempt) => {
    if (attempt === 1) return Promise.reject(new ArtifactFormatError('Malformed output.'));
    if (attempt === 2) {
      const { call } = await recordCall(
        f.options.context.store,
        'fixture',
        {
          requirementId: null,
          edgeCaseId: null,
          question: 'Synthetic clarification',
          options: [],
          assumption: 'Synthetic assumption',
          owner: 'you',
        },
        'decision',
        'run',
      );
      await answerCall(f.options.context.store, 'fixture', call.id, 'New answer');
      return { value: { accepted: false }, version: 'fixture' };
    }
    assert.match(request.prompt, /validation_feedback/);
    assert.match(request.prompt, /prior_user_answers/);
    assert.match(request.prompt, /New answer/);
    request.progress('Synthetic progress');
    return Promise.resolve({
      value: { accepted: true },
      version: 'fixture',
      model: 'fixture-model',
    });
  });
  try {
    let checkpoints = 0;
    const stage = createModelStage({
      ...f.options,
      includeAnswers: true,
      onStage: () => {
        checkpoints++;
        return Promise.resolve();
      },
    });
    assert.deepEqual(await stage('understand', schema, {}, (value) => schema.parse(value)), {
      accepted: true,
    });
    assert.equal(f.calls(), 3);
    assert.equal(checkpoints, 1);
    assert.equal(f.run.runtimeModel, 'fixture-model');
    assert.ok(f.events.some((event) => event.message === 'Synthetic progress'));
    await stage('understand', schema, {}, (value) => schema.parse(value));
    assert.equal(f.calls(), 3);
    assert.equal(checkpoints, 1);
    await atomic(path.join(f.root, 'understand.json'), { accepted: false });
    await assert.rejects(stage('understand', schema, {}, (value) => schema.parse(value)));
    assert.equal(f.calls(), 3, 'invalid stored output must not silently trigger paid work');
  } finally {
    await f.close();
  }
});

void test('provider transport or authentication failure submits one turn, including estimation', async () => {
  for (const name of ['understand', 'estimate-original']) {
    const f = await stageFixture(() =>
      Promise.reject(new Error('Synthetic provider disconnected.')),
    );
    try {
      const stage = createModelStage(f.options);
      await assert.rejects(
        stage(name, schema, {}, (value) => schema.parse(value)),
        /disconnected/,
      );
      assert.equal(f.calls(), 1);
      assert.equal(await optionalJson(path.join(f.root, `${name}.json`)), null);
    } finally {
      await f.close();
    }
  }
});

void test('checkpoint write failure cannot retry a paid turn or overwrite a previous manifest', async () => {
  const f = await stageFixture(() =>
    Promise.resolve({ value: { accepted: true }, version: 'fixture' }),
  );
  try {
    await mkdir(path.join(f.root, 'understand.json'));
    await atomic(path.join(f.root, 'manifest.json'), { previous: true });
    const stage = createModelStage(f.options);
    // Existing directory is a read failure, so it must stop before the provider.
    await assert.rejects(stage('understand', schema, {}, (value) => schema.parse(value)));
    assert.equal(f.calls(), 0);
    await rm(path.join(f.root, 'understand.json'), { recursive: true });
    const interrupted = createModelStage({
      ...f.options,
      onStage: () => mkdir(path.join(f.root, 'understand.json')),
    });
    await assert.rejects(interrupted('understand', schema, {}, (value) => schema.parse(value)));
    assert.equal(f.calls(), 1);
    assert.deepEqual(await json(path.join(f.root, 'manifest.json')), { previous: true });
  } finally {
    await f.close();
  }
});

void test('cancellation after provider completion cannot persist or retry its result', async () => {
  const f = await stageFixture(() => {
    f.controller.abort();
    return Promise.resolve({ value: { accepted: true }, version: 'fixture' });
  });
  try {
    await assert.rejects(
      createModelStage(f.options)('understand', schema, {}, (value) => schema.parse(value)),
      /abort/i,
    );
    assert.equal(f.calls(), 1);
    assert.equal(await optionalJson(path.join(f.root, 'understand.json')), null);
  } finally {
    await f.close();
  }
});

void test('invalid structured output has exactly two correction attempts and no accepted checkpoint', async () => {
  for (const malformed of [true, false]) {
    const f = await stageFixture(() =>
      malformed
        ? Promise.reject(new ArtifactFormatError('Malformed JSON.'))
        : Promise.resolve({ value: {}, version: 'fixture' }),
    );
    try {
      f.run.runtimeModel = 'stale-model';
      await writeFile(path.join(f.root, 'answers.json'), '[]');
      await assert.rejects(
        createModelStage(f.options)('understand', schema, {}, (value) => schema.parse(value)),
        /after two corrections/,
      );
      assert.equal(f.calls(), 3);
      if (!malformed) assert.equal(f.run.runtimeModel, undefined);
      assert.equal(await optionalJson(path.join(f.root, 'understand.json')), null);
    } finally {
      await f.close();
    }
  }
});
