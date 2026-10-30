import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  setupStepOf,
  setupTaskKind,
  setupTasks,
  taskStatusLabels,
  teamTaskStatus,
} from '../packages/contracts/src/task-model.js';

void test('team tasks map every lifecycle state consistently, retaining failure and cancellation distinctions', () => {
  const cases = [
    ['queued', 'To do'],
    ['leased', 'In progress'],
    ['blocked', 'To do'],
    ['review', 'In review'],
    ['verify', 'In review'],
    ['done', 'Done'],
    ['failed', 'Failed'],
    ['cancelled', 'Stopped'],
  ] as const;
  for (const [state, label] of cases) assert.equal(taskStatusLabels[teamTaskStatus(state)], label);
});

void test('setup task identities round-trip, while unrelated and unknown task kinds have no setup step', () => {
  for (const step of Object.keys(setupTasks) as (keyof typeof setupTasks)[]) {
    assert.equal(setupStepOf(setupTaskKind(step)), step);
  }
  assert.equal(setupStepOf('build'), null);
  assert.equal(setupStepOf('setup-unknown'), null);
  assert.equal(setupStepOf('confirm'), null);
});
