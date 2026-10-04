import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunEvent } from '../packages/contracts/src/index.js';
import { readCalls } from '../packages/core/src/calls.js';
import { requestClarification } from '../packages/core/src/clarification.js';
import { Store } from '../packages/core/src/storage.js';

void test('an unclassified question blocks affected work and a reversible choice may proceed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-clarify-'));
  try {
    const store = new Store(root);
    const events: RunEvent[] = [];
    const context = { store, emit: (event: RunEvent) => events.push(event) };
    const run = { id: 'run-1', projectId: 'project' };
    const signal = new AbortController().signal;
    const reply = await requestClarification(context, run, signal, {
      question: 'Which branch is production?',
      assumption: 'main',
    });
    assert.match(reply, /Blocked: Which branch is production.*Pause this requirement/);
    const reversible = await requestClarification(context, run, signal, {
      question: 'Button spacing?',
      assumption: 'Existing spacing',
      blocking: false,
    });
    assert.match(reversible, /reversible assumption: Existing spacing/);
    await requestClarification(context, run, signal, {
      question: 'Show busy to coworkers?',
      assumption: 'Show busy',
      options: ['Show busy', 'Hide'],
      requirementId: 'REQ-2',
      edgeCaseId: 'E1',
    });
    await requestClarification(context, run, signal, {
      question: 'Edge case without a requirement?',
      assumption: 'Ignore the edge case',
      edgeCaseId: 'E3',
    });
    await requestClarification(context, run, signal, {
      question: 'Which branch is production?',
      assumption: 'develop',
    });
    const calls = await readCalls(store, 'project');
    assert.equal(calls.length, 4, 'asking again does not add a call');
    assert.deepEqual(
      calls.map((c) => [c.requirementId, c.edgeCaseId, c.options.length]),
      [
        [null, null, 0],
        [null, null, 0],
        ['REQ-2', 'E1', 2],
        [null, null, 0],
      ],
    );
    const asks = events.filter((e) => e.activity?.kind === 'ask');
    assert.equal(asks.length, 4);
    assert.equal(asks[2]?.activity?.edgeCaseId, 'E1');
    assert.equal(asks[0]?.activity?.reason, 'Blocked: Which branch is production?. main');
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      requestClarification(context, run, aborted.signal, { question: 'Late?', assumption: 'No' }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
