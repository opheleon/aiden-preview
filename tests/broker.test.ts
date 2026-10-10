import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { describeToolCall, ToolBroker } from '../packages/tools/src/broker.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

async function brokerFixture() {
  const source = await fixture();
  const artifacts = path.join(source.root, 'artifacts');
  await mkdir(artifacts);
  const progress: string[] = [];
  const broker = new ToolBroker(
    source.project,
    artifacts,
    path.join(source.root, 'reads.json'),
    (request) => Promise.resolve(`Proceed assuming: ${request.assumption}`),
    (message) => progress.push(message),
  );
  broker.snapshots = source.snapshots;
  return {
    ...source,
    artifacts,
    broker,
    progress,
    location: {
      repositoryId: 'frontend',
      sha: required(source.snapshots[0]).sha,
    },
  };
}

void test('broker validates tool schemas before progress or effects and rejects out-of-project repositories', async () => {
  const f = await brokerFixture();
  try {
    await assert.rejects(f.broker.call('artifact_write', { path: 'bad', text: 42 }));
    await assert.rejects(f.broker.call('repo_inventory', { arbitrary: true }));
    assert.equal(f.progress.length, 0);
    assert.throws(() => f.broker.repo('foreign'), /Unknown repository/);
    assert.throws(
      () => required(f.broker.definitions().find((tool) => tool.name === 'repo_files')).run({}),
      /Required/,
    );
    assert.deepEqual(await f.broker.call('artifact_validate', { value: {} }), { valid: true });
    f.broker.validateArtifact = () => {
      throw new Error('Stage contract rejected.');
    };
    await assert.rejects(f.broker.call('artifact_validate', { value: {} }), /contract rejected/);
    // A call never blocks: the tool records it and tells the model to continue on its assumption.
    await assert.rejects(
      f.broker.call('request_clarification', { question: 'Which branch?' }),
      /Required/,
    );
    assert.deepEqual(
      await f.broker.call('request_clarification', {
        question: 'Which branch?',
        assumption: 'main',
      }),
      { recorded: true, instruction: 'Proceed assuming: main' },
    );
    await f.broker.call('artifact_write', { path: 'notes/readme.md', text: 'Synthetic notes' });
    assert.deepEqual(await f.broker.call('artifact_read', { path: 'notes/readme.md' }), {
      text: 'Synthetic notes',
    });
    const controller = new AbortController();
    f.broker.signal = controller.signal;
    controller.abort();
    await assert.rejects(f.broker.call('repo_inventory', {}), /abort/i);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('navigation stays on frozen commits and only evidence reads create receipts', async () => {
  const f = await brokerFixture();
  try {
    assert.deepEqual(await f.broker.call('repo_inventory', {}), {
      repositories: f.project.repositories.map(({ id, notes }) => ({ id, notes })),
      snapshots: f.snapshots,
    });
    assert.deepEqual(await f.broker.call('repo_files', { ...f.location, prefix: 'app' }), {
      files: ['app.txt'],
      nextOffset: null,
    });
    const match: any = await f.broker.call('repo_search', { ...f.location, query: 'GET' });
    assert.match(match.matches, /app.txt:1:GET/);
    assert.deepEqual(
      await f.broker.call('repo_search', { ...f.location, query: 'absent-string' }),
      { matches: '' },
    );
    const history: any = await f.broker.call('repo_history', f.location);
    assert.match(history.history, /^[a-f0-9]{40,64} \d{4}-\d{2}-\d{2} Fixture implementation/m);
    assert.deepEqual(
      await f.broker.call('repo_history', { ...f.location, match: 'no-such-subject' }),
      { history: '' },
    );
    const matched: any = await f.broker.call('repo_history', {
      ...f.location,
      match: 'FIXTURE',
      path: 'app.txt',
      since: '2000-01-01',
      limit: 5,
    });
    assert.match(matched.history, /Fixture implementation/);
    await assert.rejects(
      f.broker.call('repo_history', { ...f.location, path: '../outside' }),
      /Unsafe path/,
    );
    await assert.rejects(f.broker.call('repo_history', { ...f.location, since: 'last week' }));
    const introduced: any = await f.broker.call('repo_history', { ...f.location, changed: 'GET' });
    assert.match(introduced.history, /Fixture implementation/);
    assert.deepEqual(
      await f.broker.call('repo_history', { ...f.location, changed: 'never-written-text' }),
      { history: '' },
    );
    assert.deepEqual(
      await f.broker.call('repo_diff', {
        repositoryId: 'frontend',
        before: f.location.sha,
        after: f.location.sha,
      }),
      { diff: '' },
    );
    assert.equal(f.broker.reads.length, 0);
    await assert.rejects(f.broker.call('repo_fetch', { repositoryId: 'frontend' }), /frozen/);
    f.broker.mutationAllowed = true;
    const sync: any = await f.broker.call('repo_sync', { repositoryId: 'frontend' });
    assert.match(sync.warnings[0], /upstream/);
    assert.deepEqual(await f.broker.call('repo_fetch', { repositoryId: 'frontend' }), { ok: true });
    await assert.rejects(
      f.broker.call('repo_read', { ...f.location, path: '../secret' }),
      /Unsafe/,
    );
    await assert.rejects(
      f.broker.call('repo_read', { ...f.location, path: 'app.txt', startLine: 100 }),
      /outside/,
    );
    const evidence: any = await f.broker.call('repo_read', { ...f.location, path: 'app.txt' });
    assert.match(evidence.text, /1: GET/);
    assert.deepEqual(JSON.parse(await readFile(f.broker.receiptsFile, 'utf8')), f.broker.reads);
    f.project.repositories[0]!.path = path.join(f.root, 'missing');
    await assert.rejects(
      f.broker.call('repo_search', { ...f.location, query: 'GET' }),
      /Git operation failed/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('file pagination and evidence limits cannot overstate the lines actually returned', async () => {
  const f = await brokerFixture();
  try {
    const repo = required(f.project.repositories[0]);
    await mkdir(path.join(repo.path, 'many'));
    await Promise.all(
      Array.from({ length: 301 }, (_, index) =>
        writeFile(path.join(repo.path, 'many', `${index}.txt`), 'test'),
      ),
    );
    await writeFile(
      path.join(repo.path, 'bounded.txt'),
      Array.from({ length: 260 }, () => 'x'.repeat(100)).join('\n'),
    );
    await writeFile(path.join(repo.path, 'oversized.txt'), 'x'.repeat(12000));
    await g(repo.path, 'add', '.');
    await g(repo.path, 'commit', '-m', 'Synthetic read limits');
    const sha = await g(repo.path, 'rev-parse', 'HEAD');
    f.broker.snapshots.push({ ...required(f.snapshots[0]), sha });
    const location = { repositoryId: repo.id, sha };
    const first: any = await f.broker.call('repo_files', { ...location, prefix: 'many/' });
    assert.equal(first.files.length, 300);
    assert.equal(first.nextOffset, 300);
    const last: any = await f.broker.call('repo_files', {
      ...location,
      prefix: 'many/',
      offset: first.nextOffset,
    });
    assert.equal(last.files.length, 1);
    assert.equal(last.nextOffset, null);
    const read: any = await f.broker.call('repo_read', {
      ...location,
      path: 'bounded.txt',
      endLine: 260,
    });
    assert.ok(read.text.length <= 12000);
    assert.ok(read.endLine < 250);
    assert.equal(read.text.split('\n').length, read.endLine);
    assert.equal(required(f.broker.reads[0]).endLine, read.endLine);
    await assert.rejects(
      f.broker.call('repo_read', { ...location, path: 'oversized.txt' }),
      /read limit/,
    );
    assert.equal(f.broker.reads.length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('external reads require project selection and persist the exact receipt before returning', async () => {
  const f = await brokerFixture();
  try {
    await assert.rejects(f.broker.call('external_read', {}), /not allowed/);
    let calls = 0;
    const receipt = {
      connectionId: 'context',
      tool: 'read',
      argumentsHash: 'a'.repeat(64),
      resultHash: 'b'.repeat(64),
      calledAt: '2026-09-26T00:00:00.000Z',
      recordCount: 1,
    };
    f.broker.externalCall = (connectionId, tool, args, signal) => {
      calls++;
      assert.equal(tool, 'read');
      assert.deepEqual(args, { id: 'synthetic' });
      assert.equal(signal, f.broker.signal);
      return Promise.resolve({ result: { fixture: true }, receipt: { ...receipt, connectionId } });
    };
    const input = { connectionId: 'context', tool: 'read', arguments: { id: 'synthetic' } };
    await assert.rejects(f.broker.call('external_read', input), /not selected/);
    assert.equal(calls, 0);
    f.project.sources = {
      contextConnectionIds: ['context'],
      history: {
        connectionId: 'history',
        sourceId: 'fixture',
        sourceLabel: 'Synthetic history',
        historyTool: 'read',
        sourceArgument: 'id',
      },
    };
    assert.deepEqual(await f.broker.call('external_read', input), { fixture: true });
    await f.broker.call('external_read', { ...input, connectionId: 'history' });
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'external-reads.json'), 'utf8')), [
      receipt,
      { ...receipt, connectionId: 'history' },
    ]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('failed receipt writes grant no evidence and concurrent reads preserve every receipt', async () => {
  const f = await brokerFixture();
  try {
    const receipts = f.broker.receiptsFile;
    f.broker.receiptsFile = f.artifacts; // Rename over a directory must fail atomically.
    await assert.rejects(f.broker.call('repo_read', { ...f.location, path: 'app.txt' }));
    assert.equal(f.broker.reads.length, 0);
    f.broker.receiptsFile = receipts;
    await Promise.all(
      [1, 2].map((startLine) =>
        f.broker.call('repo_read', {
          ...f.location,
          path: 'app.txt',
          startLine,
          endLine: startLine,
        }),
      ),
    );
    assert.equal(f.broker.reads.length, 2);
    assert.deepEqual(JSON.parse(await readFile(receipts, 'utf8')), f.broker.reads);
    assert.deepEqual(f.broker.reads.map((receipt) => receipt.startLine).sort(), [1, 2]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('tool calls read as plain steps that use folder names', () => {
  const names = new Map([['repo-1', 'calendar-ui']]);
  const steps = [
    describeToolCall(
      'repo_read',
      { repositoryId: 'repo-1', path: 'src/App.tsx', startLine: 40 },
      names,
    ),
    describeToolCall('repo_files', { repositoryId: 'repo-1', prefix: 'src' }, names),
    describeToolCall('repo_search', { repositoryId: 'repo-1', query: 'drag' }, names),
    describeToolCall('repo_history', { repositoryId: 'repo-9' }, names),
    describeToolCall('repo_history', { repositoryId: 'repo-1', match: 'bundled' }, names),
    describeToolCall('repo_history', { repositoryId: 'repo-1', changed: 'is in beta' }, names),
    describeToolCall('repo_diff', { repositoryId: 'repo-1' }, names),
    describeToolCall('repo_inventory', {}, names),
    describeToolCall('artifact_write', {}, names),
    describeToolCall('artifact_validate', {}, names),
    describeToolCall('external_read', { tool: 'list_issues' }, names),
    describeToolCall('request_clarification', {}, names),
    describeToolCall('repo_sync', {}, names),
  ];
  assert.deepEqual(steps, [
    'Read calendar-ui/src/App.tsx from line 40',
    'Listed files in calendar-ui/src',
    'Searched calendar-ui for "drag"',
    'Read the commit history of repo-9',
    'Searched the commit history of calendar-ui for "bundled"',
    'Looked for when "is in beta" changed in calendar-ui',
    'Compared two commits in calendar-ui',
    'Listed the repositories and their branches',
    'Updated its working notes',
    'Checked its answer against the expected format',
    'Read from list_issues',
    'Wrote down a question for you',
    'Used repo sync',
  ]);
});
