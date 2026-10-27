import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import type { AccountsClient } from '../packages/core/src/accounts/client.js';
import { shareProject } from '../packages/core/src/accounts/methods.js';
import { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

const at = '2026-10-27T02:00:00.000Z';

void test('a project made on this computer syncs into the team with its id and its own code folders', async () => {
  const f = await fixture();
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, new FixtureRuntime(f));
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const client = {
    createProject: (input: Record<string, unknown>) => {
      calls.push({ method: 'createProject', input });
      return Promise.resolve({
        project: {
          id: input.id,
          accountId: input.accountId,
          name: input.name,
          runtime: input.runtime,
          document: input.document,
          revision: 1,
          status: 'active',
          createdAt: at,
          updatedAt: at,
        },
        tasks: [],
      });
    },
  } as unknown as AccountsClient;
  try {
    const folder = store.project(f.project.id);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'project.json'), JSON.stringify(f.project));
    const synced = await shareProject(engine, client, {
      accountId: 'acct-1',
      projectId: f.project.id,
    });
    const sent = calls[0]?.input;
    assert.equal(sent?.id, f.project.id, 'keeps its id, so its runs and answers stay with it');
    assert.deepEqual(
      (sent?.tasks as { kind: string }[]).map((t) => t.kind),
      ['write-requirements'],
      'without requirements yet, the team writes them',
    );
    assert.deepEqual(synced?.account, { accountId: 'acct-1', revision: 1 });
    assert.deepEqual(
      synced?.repositories.map((r) => r.path),
      f.project.repositories.map((r) => r.path),
      'this computer keeps reading the code folders it read before',
    );
    await assert.rejects(
      shareProject(engine, client, { accountId: 'acct-1', projectId: f.project.id }),
      /already in your team/,
    );
    assert.equal(calls.length, 1);
  } finally {
    await engine.dispose();
  }
});
