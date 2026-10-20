import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Engine } from '../packages/core/src/engine.js';
import { atomic, Store } from '../packages/core/src/storage.js';

void test('projects list newest first by their first run, whatever their ID order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-order-'));
  const store = new Store(root);
  const engine = new Engine(store);
  try {
    // IDs sort opposite to creation, so folder order alone would list them oldest first.
    const created = [
      ['zzz-newest', '2026-10-18T09:00:00.000Z'],
      ['mmm-middle', '2026-10-10T09:00:00.000Z'],
      ['aaa-oldest', '2026-09-01T09:00:00.000Z'],
    ] as const;
    for (const [id, at] of created) {
      const project = {
        id,
        name: id,
        context: `Synthetic project ${id}`,
        rootPath: '/synthetic',
        repositories: [],
        runtime: { provider: 'codex', auth: 'subscription' },
      };
      await atomic(path.join(store.project(id), 'project.json'), project);
      // A later run must not move the project; only its first run says when it was created.
      for (const [run, when] of [
        ['first', at],
        ['later', '2026-10-19T09:00:00.000Z'],
      ])
        await atomic(path.join(store.run(id, `${id}-${run}`), 'manifest.json'), {
          id: `${id}-${run}`,
          projectId: id,
          kind: 'report',
          status: 'completed',
          stage: 'done',
          project,
          createdAt: when,
        });
    }
    assert.deepEqual(
      (await engine.projects()).map((p) => p.id),
      ['zzz-newest', 'mmm-middle', 'aaa-oldest'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
