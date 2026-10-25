import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  deliveryGitServices,
  findJobPullRequest,
  publishJobBranch,
} from '../packages/tools/src/delivery-git.js';

void test('a lost PR creation acknowledgement reuses verified publication and never creates twice', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-publication-'));
  const previous = process.env.PATH;
  const marker = path.join(root, 'created');
  const commit = 'a'.repeat(40);
  const branch = 'aiden/job-abc';
  const url = 'https://github.com/team/app/pull/1';
  let pushes = 0;
  try {
    await writeFile(
      path.join(root, 'gh'),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(marker)}, 'created\\n');process.exit(1);`,
      { mode: 0o700 },
    );
    process.env.PATH = `${root}${path.delimiter}${previous ?? ''}`;
    t.mock.method(deliveryGitServices, 'github', (args: string[]) =>
      Promise.resolve(
        args[1] === 'list'
          ? existsSync(marker)
            ? [{ url }]
            : []
          : {
              url,
              state: 'OPEN',
              headRefName: branch,
              headRefOid: commit,
              baseRefName: 'main',
              headRepository: { name: 'app' },
              headRepositoryOwner: { login: 'team' },
              mergeCommit: null,
              reviewDecision: null,
              statusCheckRollup: [],
            },
      ),
    );
    t.mock.method(deliveryGitServices, 'git', (_cwd: string, args: string[]) => {
      if (args.includes('push')) pushes++;
      return Promise.resolve(args[0] === 'rev-parse' ? commit : '');
    });
    const input = {
      worktree: root,
      repository: 'team/app',
      branch,
      baseBranch: 'main',
      commit,
      title: 'Fixture',
      body: 'Synthetic publication',
      signal: new AbortController().signal,
      authorize: () => Promise.resolve(),
    };
    assert.equal(await publishJobBranch(input), url);
    assert.equal(await publishJobBranch(input), url);
    assert.equal(pushes, 1);
    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(marker, 'utf8'), 'created\n');
    await assert.rejects(
      publishJobBranch({ ...input, commit: 'b'.repeat(40) }),
      /checkpointed commit/,
    );
    await assert.rejects(
      publishJobBranch({ ...input, authorize: () => Promise.reject(new Error('stale attempt')) }),
      /stale attempt/,
    );
    assert.equal(pushes, 1);
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

void test('replacement machines publish only the exact already-pushed checkpoint, without a local push', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-remote-publication-'));
  const previous = process.env.PATH;
  const commit = 'a'.repeat(40);
  const branch = 'aiden/job-abc';
  const url = 'https://github.com/team/app/pull/1';
  let remote = `${commit}\trefs/heads/${branch}\n`;
  try {
    await writeFile(
      path.join(root, 'gh'),
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(url)});`,
      { mode: 0o700 },
    );
    process.env.PATH = `${root}${path.delimiter}${previous ?? ''}`;
    t.mock.method(deliveryGitServices, 'github', (args: string[]) =>
      Promise.resolve(
        args[1] === 'list'
          ? []
          : {
              url,
              state: 'OPEN',
              headRefName: branch,
              headRefOid: commit,
              baseRefName: 'main',
              headRepository: { name: 'app' },
              headRepositoryOwner: { login: 'team' },
              mergeCommit: null,
              reviewDecision: null,
              statusCheckRollup: [],
            },
      ),
    );
    t.mock.method(deliveryGitServices, 'git', (_cwd: string, args: string[]) => {
      assert.ok(args.includes('ls-remote'), 'remote recovery must never push local files');
      return Promise.resolve(remote);
    });
    const input = {
      worktree: root,
      repository: 'team/app',
      branch,
      baseBranch: 'main',
      commit,
      title: 'Fixture',
      body: 'Synthetic publication',
      remoteOnly: true,
      signal: new AbortController().signal,
      authorize: () => Promise.resolve(),
    };
    assert.equal(await publishJobBranch(input), url);
    remote = '';
    await assert.rejects(publishJobBranch(input), /previous machine/);
    remote = `${'b'.repeat(40)}\trefs/heads/${branch}`;
    await assert.rejects(publishJobBranch(input), /remote branch differs/);
    remote = `${commit}\trefs/heads/${branch}`;
    await writeFile(
      path.join(root, 'gh'),
      `#!${process.execPath}\nprocess.stdout.write('unrecognized output');`,
      { mode: 0o700 },
    );
    await assert.rejects(publishJobBranch(input), /could not open the pull request/);
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

void test('publication refuses ambiguous PRs, altered local commits, unrelated branches and cancelled authority', async (t) => {
  const urls = [
    { url: 'https://github.com/team/app/pull/1' },
    { url: 'https://github.com/team/app/pull/2' },
  ];
  t.mock.method(deliveryGitServices, 'github', () => Promise.resolve(urls));
  await assert.rejects(
    findJobPullRequest('team/app', 'aiden/job-abc', 'main'),
    /Multiple pull requests/,
  );
  t.mock.method(deliveryGitServices, 'github', () => Promise.resolve([]));
  t.mock.method(deliveryGitServices, 'git', (_cwd: string, args: string[]) => {
    assert.deepEqual(args, ['rev-parse', 'HEAD']);
    return Promise.resolve('b'.repeat(40));
  });
  const input = {
    worktree: '/tmp',
    repository: 'team/app',
    branch: 'aiden/job-abc',
    baseBranch: 'main',
    commit: 'a'.repeat(40),
    title: 'Fixture',
    body: 'Synthetic publication',
  };
  await assert.rejects(publishJobBranch(input), /worktree changed/);
  await assert.rejects(publishJobBranch({ ...input, branch: 'main' }), /only its own job branches/);
  await assert.rejects(
    publishJobBranch({ ...input, signal: AbortSignal.abort(new Error('Cancelled')) }),
    /Cancelled/,
  );
});
