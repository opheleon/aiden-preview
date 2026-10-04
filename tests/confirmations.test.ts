import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { confirmAction, readConfirmations } from '../packages/core/src/confirmations.js';
import { Store } from '../packages/core/src/storage.js';

void test('manual tests marked done are kept per report, and concurrent marks are all saved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-confirm-'));
  try {
    const store = new Store(root);
    assert.deepEqual(await readConfirmations(store, 'project'), {});
    await Promise.all([
      confirmAction(store, 'project', 'REQ-1-E2', 'report-1'),
      confirmAction(store, 'project', 'REQ-2', 'report-1'),
    ]);
    await confirmAction(store, 'project', 'REQ-2', 'report-2');
    assert.deepEqual(await readConfirmations(store, 'project'), {
      'REQ-1-E2': 'report-1',
      'REQ-2': 'report-2',
    });
    await assert.rejects(confirmAction(store, 'project', 'not a key', 'report-1'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
