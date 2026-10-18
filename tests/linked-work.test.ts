import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { Discovery } from '../packages/contracts/src/index.js';
import { linkedWork, repositoryRemotes } from '../packages/core/src/linked-work.js';
import { linkState } from '../packages/tools/src/github-pulls.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

/** Synthetic GitHub issue payloads by number; unknown numbers answer 404 like a missing link. */
function fakeGithub(states: Record<number, object>): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const number = Number(url.split('/').at(-1));
    const body = states[number];
    return Promise.resolve(
      body
        ? new Response(
            JSON.stringify({
              number,
              title: `Synthetic ${number}`,
              created_at: '2026-09-01T00:00:00Z',
              updated_at: '2026-10-01T00:00:00Z',
              html_url: `https://github.com/acme/widgets-ui/pull/${number}`,
              ...body,
            }),
          )
        : new Response('{}', { status: 404 }),
    );
  };
}

const pull = (state: string, merged: string | null, draft = false) => ({
  state,
  draft,
  pull_request: { merged_at: merged },
});

void test('linked work resolves merged commits per repository and labels open, closed, and unknown links', async () => {
  const f = await fixture();
  try {
    const frontend = required(f.project.repositories[0]);
    const backend = required(f.project.repositories[1]);
    await g(frontend.path, 'remote', 'add', 'origin', 'git@github.com:acme/widgets-ui.git');
    await g(backend.path, 'remote', 'add', 'origin', 'https://gitlab.com/acme/api.git');
    for (const subject of ['Bump release tooling (#47120)', 'Content mappers (#4712)']) {
      await writeFile(path.join(frontend.path, 'app.txt'), subject);
      await g(frontend.path, 'commit', '-am', subject);
    }
    const head = await g(frontend.path, 'rev-parse', 'HEAD');
    const remotes = await repositoryRemotes(f.project.repositories);
    assert.deepEqual([...remotes.keys()], ['frontend', 'backend']);
    const snapshots: Discovery['snapshots'] = [
      {
        repositoryId: 'frontend',
        sha: head,
        branch: 'main',
        role: 'default',
        reason: 'Fixture',
        source: 'remote-branch',
      },
    ];
    const github = fakeGithub({
      4712: pull('closed', '2026-08-19T00:00:00Z'),
      471: pull('open', null, true),
      472: pull('closed', '2026-08-01T00:00:00Z'),
      473: pull('closed', null),
      474: { state: 'open' },
      6095: { state: 'open' },
    });
    const intent = [
      ...[4712, 4712, 471, 472, 473, 474, 475].map(
        (n) => `https://github.com/acme/widgets-ui/pull/${n}`,
      ),
      'https://github.com/acme/rollup/issues/6095',
      'https://github.com/acme/rollup/pull/1',
    ].join('\n');
    const work = await linkedWork(
      intent,
      remotes,
      (id) => required(f.project.repositories.find((r) => r.id === id)).path,
      snapshots,
      undefined,
      github,
    );
    assert.deepEqual(
      work.map((w) => [
        w.url.split('/').slice(-2).join('/'),
        w.repositoryId,
        w.merged?.subject ?? null,
        w.note,
      ]),
      [
        ['pull/4712', 'frontend', 'Content mappers (#4712)', 'Merged on the selected branch.'],
        [
          'pull/471',
          'frontend',
          null,
          'Open draft pull request, not merged on the selected branch: work in progress.',
        ],
        ['pull/472', 'frontend', null, 'Merged on GitHub but not found on the selected branch.'],
        [
          'pull/473',
          'frontend',
          null,
          'Closed without merging; not merged on the selected branch.',
        ],
        ['pull/474', 'frontend', null, 'Open issue, not merged on the selected branch.'],
        [
          'pull/475',
          'frontend',
          null,
          'Not merged on the selected branch; GitHub did not answer, so its state is unknown.',
        ],
        ['issues/6095', null, null, 'Open issue, in a repository Aiden does not read.'],
        [
          'pull/1',
          null,
          null,
          'In a repository Aiden does not read; GitHub did not answer, so its state is unknown.',
        ],
      ],
    );
    assert.match(required(work[0]).merged?.date ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(required(work[1]).live, {
      kind: 'pull',
      state: 'open',
      draft: true,
      title: 'Synthetic 471',
      updated: '2026-10-01',
    });
    const unreadable = await linkedWork(
      'https://github.com/acme/widgets-ui/pull/9',
      remotes,
      () => path.join(f.root, 'not-a-repository'),
      snapshots,
      undefined,
      fakeGithub({}),
    );
    assert.match(required(unreadable[0]).note, /could not be searched and GitHub did not answer/);
    await g(frontend.path, 'remote', 'remove', 'origin');
    assert.deepEqual([...(await repositoryRemotes(f.project.repositories)).keys()], ['backend']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('link state treats network failures and malformed payloads as unknown', async () => {
  const repo = { owner: 'acme', name: 'widgets-ui' };
  const failing: typeof fetch = () => Promise.reject(new Error('offline'));
  assert.equal(await linkState(repo, 1, undefined, failing), null);
  const malformed: typeof fetch = () => Promise.resolve(new Response('{"number":"x"}'));
  assert.equal(await linkState(repo, 1, new AbortController().signal, malformed), null);
});
