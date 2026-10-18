import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { describeToolCall, ToolBroker } from '../packages/tools/src/broker.js';
import {
  githubRepository,
  rateLimitWait,
  searchPullRequests,
} from '../packages/tools/src/github-pulls.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

/** A fake GitHub search response; the requested URLs are kept for assertions. */
function fakeGithub(status: number, items: unknown[] = []) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    urls.push(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(
      new Response(JSON.stringify({ total_count: items.length, items }), { status }),
    );
  };
  return { urls, fetchImpl };
}

const item = (number: number, state: string, merged: string | null, draft = false) => ({
  number,
  title: `Synthetic pull request ${number}`,
  state,
  draft,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  html_url: `https://github.com/acme/widgets/pull/${number}`,
  pull_request: { merged_at: merged },
});

void test('only github.com remotes resolve to a repository', () => {
  const expected = { owner: 'acme', name: 'widgets' };
  for (const remote of [
    'https://github.com/acme/widgets.git',
    'https://github.com/acme/widgets',
    'https://x-access-token:secret@github.com/acme/widgets.git',
    'git@github.com:acme/widgets.git',
    'ssh://git@github.com/acme/widgets.git',
  ])
    assert.deepEqual(githubRepository(remote), expected, remote);
  for (const remote of [
    'https://gitlab.com/acme/widgets.git',
    'git@github.example.com:acme/widgets.git',
    '/srv/git/widgets',
  ])
    assert.equal(githubRepository(remote), null, remote);
});

void test('pull request search stays inside one repository and labels merged, open, and closed work', async () => {
  const github = fakeGithub(200, [
    item(1, 'open', null, true),
    item(2, 'closed', '2026-10-06T00:00:00Z'),
    item(3, 'closed', null),
  ]);
  const result = await searchPullRequests(
    { owner: 'acme', name: 'widgets' },
    'glob watch repo:other/secret is:merged',
    'open',
    undefined,
    github.fetchImpl,
  );
  const query = new URL(required(github.urls[0])).searchParams.get('q');
  assert.equal(query, 'repo:acme/widgets is:pr is:open glob watch');
  assert.deepEqual(
    'pullRequests' in result && result.pullRequests.map((p) => [p.number, p.state, p.draft]),
    [
      [1, 'open', true],
      [2, 'merged', false],
      [3, 'closed', false],
    ],
  );
  for (const [status, reason] of [
    [403, /rate-limited/],
    [429, /rate-limited/],
    [404, /private or unavailable/],
  ] as const)
    assert.match(
      JSON.stringify(
        await searchPullRequests(
          { owner: 'acme', name: 'widgets' },
          'glob',
          'all',
          undefined,
          fakeGithub(status).fetchImpl,
        ),
      ),
      reason,
    );
});

void test('an empty multi-word search retries once with its longest word and says so', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    urls.push(url);
    const broad = !new URL(url).searchParams.get('q')?.includes('bundled');
    const items = broad ? [item(20374, 'open', null, true)] : [];
    return Promise.resolve(new Response(JSON.stringify({ total_count: items.length, items })));
  };
  const result = await searchPullRequests(
    { owner: 'acme', name: 'widgets' },
    'transformIndexHtml bundled dev',
    'open',
    undefined,
    fetchImpl,
  );
  assert.equal(urls.length, 2);
  assert.equal(
    new URL(required(urls[1])).searchParams.get('q'),
    'repo:acme/widgets is:pr is:open transformIndexHtml',
  );
  assert.deepEqual(
    'pullRequests' in result && [result.broadenedTo, result.pullRequests[0]?.number],
    ['transformIndexHtml', 20374],
  );
});

void test('merged filters, one-word searches, a rate-limited retry, and sparse items stay explicit', async () => {
  const repo = { owner: 'acme', name: 'widgets' };
  const sparse = { ...item(9, 'open', null), draft: undefined, pull_request: undefined };
  const merged = fakeGithub(200, [sparse]);
  const controller = new AbortController();
  const found = await searchPullRequests(
    repo,
    'pause',
    'merged',
    controller.signal,
    merged.fetchImpl,
  );
  assert.equal(
    new URL(required(merged.urls[0])).searchParams.get('q'),
    'repo:acme/widgets is:pr is:merged pause',
  );
  assert.deepEqual('pullRequests' in found && found.pullRequests[0], {
    number: 9,
    title: 'Synthetic pull request 9',
    state: 'open',
    draft: false,
    created: '2026-09-01',
    updated: '2026-10-01',
    url: 'https://github.com/acme/widgets/pull/9',
  });
  const single = fakeGithub(200);
  assert.deepEqual(await searchPullRequests(repo, 'pause', 'all', undefined, single.fetchImpl), {
    total: 0,
    pullRequests: [],
  });
  assert.equal(single.urls.length, 1);
  let calls = 0;
  const limited: typeof fetch = () =>
    Promise.resolve(
      calls++ === 0
        ? new Response(JSON.stringify({ total_count: 0, items: [] }))
        : new Response('{}', { status: 403 }),
    );
  assert.deepEqual(await searchPullRequests(repo, 'pause resume', 'open', undefined, limited), {
    total: 0,
    pullRequests: [],
  });
});

void test('a rate-limited search waits for the stated reset once, and gives up on long waits', async () => {
  const repo = { owner: 'acme', name: 'widgets' };
  let calls = 0;
  const resetsNow: typeof fetch = () =>
    Promise.resolve(
      calls++ === 0
        ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
        : new Response(JSON.stringify({ total_count: 1, items: [item(5, 'open', null)] })),
    );
  const found = await searchPullRequests(repo, 'pause', 'open', undefined, resetsNow);
  assert.equal(calls, 2);
  assert.equal('pullRequests' in found && found.pullRequests[0]?.number, 5);
  const later = String(Math.floor(Date.now() / 1000) + 600);
  const longWait: typeof fetch = () =>
    Promise.resolve(new Response('{}', { status: 403, headers: { 'x-ratelimit-reset': later } }));
  assert.match(
    JSON.stringify(await searchPullRequests(repo, 'pause', 'open', undefined, longWait)),
    /rate-limited/,
  );
  const now = 1_000_000_000_000;
  assert.equal(rateLimitWait(new Headers({ 'retry-after': '2' }), now), 3000);
  assert.equal(
    rateLimitWait(new Headers({ 'x-ratelimit-reset': String(now / 1000 + 10) }), now),
    11_000,
  );
  assert.equal(rateLimitWait(new Headers(), now), null);
});

void test('the broker searches the selected remote and explains when it cannot', async () => {
  const f = await fixture();
  const artifacts = path.join(f.root, 'artifacts');
  await mkdir(artifacts);
  const broker = new ToolBroker(f.project, artifacts, path.join(f.root, 'reads.json'), () =>
    Promise.resolve(''),
  );
  const repo = required(f.project.repositories[0]);
  try {
    assert.match(
      JSON.stringify(
        await broker.call('repo_pull_requests', { repositoryId: repo.id, query: 'x' }),
      ),
      /no readable remote/,
    );
    // Frozen snapshot copies have no remotes; the remote read from the checkout still applies.
    const frozen = fakeGithub(200, [item(3, 'open', null)]);
    broker.fetchPulls = frozen.fetchImpl;
    broker.remotes.set(repo.id, 'https://github.com/acme/widgets.git');
    assert.match(
      JSON.stringify(
        await broker.call('repo_pull_requests', { repositoryId: repo.id, query: 'x' }),
      ),
      /pull\/3/,
    );
    // With no state given, the search covers open, merged, and closed pull requests.
    assert.equal(
      new URL(required(frozen.urls[0])).searchParams.get('q'),
      'repo:acme/widgets is:pr x',
    );
    broker.remotes.clear();
    await g(repo.path, 'remote', 'add', 'origin', 'https://gitlab.com/acme/widgets.git');
    assert.match(
      JSON.stringify(
        await broker.call('repo_pull_requests', { repositoryId: repo.id, query: 'x' }),
      ),
      /github.com repositories only/,
    );
    await g(repo.path, 'remote', 'set-url', 'origin', 'git@github.com:acme/widgets.git');
    const github = fakeGithub(200, [item(7, 'open', null)]);
    broker.fetchPulls = github.fetchImpl;
    const found: any = await broker.call('repo_pull_requests', {
      repositoryId: repo.id,
      query: 'pause',
      state: 'all',
    });
    assert.equal(found.pullRequests[0].url, 'https://github.com/acme/widgets/pull/7');
    assert.equal(
      new URL(required(github.urls[0])).searchParams.get('q'),
      'repo:acme/widgets is:pr pause',
    );
    assert.equal(broker.reads.length, 0);
    assert.equal(
      describeToolCall('repo_pull_requests', { repositoryId: repo.id, query: 'pause' }, new Map()),
      `Looked for pull requests in ${repo.id} about "pause"`,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
