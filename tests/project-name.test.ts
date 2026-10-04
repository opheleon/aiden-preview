import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scopeName } from '../packages/contracts/src/project-name.js';
import { commitBaseline } from '../packages/core/src/baseline.js';
import { Engine } from '../packages/core/src/engine.js';
import { createRun } from '../packages/core/src/run-lifecycle.js';
import { atomic, Store } from '../packages/core/src/storage.js';

void test('scope names distinguish projects in the same folder and follow scope revisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-names-'));
  const store = new Store(root);
  const engine = new Engine(store);
  const product = {
    overview: 'Reduce AWS costs without changing customer behavior.',
    requirements: [{ id: 'REQ-1', text: 'Reduce infrastructure costs.' }],
    milestones: [],
  };
  try {
    for (const [id, context] of [
      ['costs', 'Reduce AWS costs'],
      ['onboarding', 'Customer onboarding'],
    ]) {
      await atomic(path.join(store.project(id!), 'project.json'), {
        id,
        name: 'app',
        context,
        rootPath: '/shared/app',
        repositories: [{ id: 'repo', path: '/shared/app', notes: '' }],
        runtime: { provider: 'codex', auth: 'subscription' },
      });
    }
    await commitBaseline(store, 'costs', product, 'Reduce AWS costs');
    assert.deepEqual((await engine.projects()).map((p) => p.name).sort(), [
      'Customer onboarding',
      'Reduce AWS costs without changing customer behavior',
    ]);
    await commitBaseline(
      store,
      'costs',
      { ...product, title: 'Reduce AWS costs' },
      'Reduce AWS costs',
    );
    assert.equal((await engine.state('costs')).project?.name, 'Reduce AWS costs');
    await commitBaseline(
      store,
      'costs',
      { ...product, title: 'Optimize production hosting' },
      'Reduce AWS costs',
    );
    const saved = (await engine.projects()).find((p) => p.id === 'costs')!;
    assert.equal(saved.name, 'Optimize production hosting');
    assert.equal(saved.rootPath, '/shared/app');
    const baseline = (await engine.state('costs')).baseline!;
    const run = await createRun(store, { ...saved, name: 'app' }, 'report', baseline);
    assert.equal(run.project.name, saved.name);
    assert.equal(run.project.id, 'costs');
    assert.equal((await engine.state('costs')).baseline?.product.title, saved.name);
    assert.equal((await engine.state('missing')).project, null);
  } finally {
    await engine.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

void test('legacy scope labels remain readable with long or empty intent', () => {
  assert.equal(scopeName(''), 'New project');
  assert.equal(
    scopeName('Reduce AWS spend for ProdGrade by adding an idle switch.'),
    'Reduce AWS spend for ProdGrade',
  );
  assert.equal(scopeName('Search by author'), 'Search by author');
  assert.equal(scopeName('  Calendar\n scheduling. More details.'), 'Calendar scheduling');
  assert.equal(scopeName('x'.repeat(100)).length, 72);
  assert.match(scopeName('A useful outcome with several words '.repeat(5)), /…$/);
});
