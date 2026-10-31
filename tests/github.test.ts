import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGithubRepository, syncGithubRepository } from '../packages/tools/src/github.js';
import {
  githubCliEnv,
  githubFile,
  githubFolder,
  listGithubAccounts,
  listGithubRepositories,
  maxConnectedRepositories,
} from '../packages/tools/src/github-accounts.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

/** Run a test with environment overrides, restoring the previous values afterwards. */
async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}

/** A fake GitHub CLI on PATH that answers the read-only calls Aiden makes, or fails on request. */
async function fakeGh(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-gh-'));
  const repos = JSON.stringify([
    {
      name: 'old',
      description: null,
      isPrivate: false,
      isFork: false,
      primaryLanguage: null,
      pushedAt: '2026-01-01T00:00:00Z',
    },
    {
      name: 'web',
      description: 'Storefront',
      isPrivate: true,
      isFork: false,
      primaryLanguage: { name: 'TypeScript' },
      pushedAt: '2026-10-01T00:00:00Z',
    },
    { name: 'fork', isFork: true },
    { name: '../escape' },
    { description: 'no name' },
  ]);
  const script = `#!/bin/sh
if [ -n "$FAKE_GH_FAIL" ]; then echo "auth required" >&2; exit 1; fi
case "$1 $2" in
  "api user") echo "sam" ;;
  "api user/orgs") printf 'acme\\nnot valid\\nacme-labs\\n' ;;
  "api repos/acme/web/contents/") echo '[{"path":"src","type":"dir"},{"path":"README.md","type":"file"},{"path":"link","type":"symlink"}]' ;;
  "api repos/acme/web/contents/README.md") echo "# Storefront web" ;;
  "api repos/acme/web/contents/one") echo '{"path":"one","type":"file"}' ;;
  "api repos/acme/web/contents/logo.png") printf 'PNG\\000data' ;;
  "repo list")
    case "$3" in
      acme) echo '${repos}' ;;
      odd) echo '{}' ;;
      *) exit 1 ;;
    esac ;;
  *) exit 2 ;;
esac
`;
  await writeFile(path.join(dir, 'gh'), script);
  await chmod(path.join(dir, 'gh'), 0o755);
  return dir;
}

void test('GitHub links, SSH remotes, and owner/name all read as one repository', () => {
  assert.deepEqual(parseGithubRepository('https://github.com/opheleon/aiden/pull/7'), {
    owner: 'opheleon',
    name: 'aiden',
  });
  assert.deepEqual(parseGithubRepository('git@github.com:acme/web.git'), {
    owner: 'acme',
    name: 'web',
  });
  assert.deepEqual(parseGithubRepository(' acme/api '), { owner: 'acme', name: 'api' });
  assert.deepEqual(parseGithubRepository('www.github.com/acme/api.git'), {
    owner: 'acme',
    name: 'api',
  });
  assert.equal(parseGithubRepository('https://gitlab.com/acme/web'), null);
  assert.equal(parseGithubRepository('.hidden/web'), null);
  assert.equal(parseGithubRepository('acme/.web'), null);
  assert.equal(parseGithubRepository('just-a-name'), null);
});

void test('a project gets its own read-only clone, refreshed on the next connect', async () => {
  const f = await fixture();
  const source = required(f.project.repositories[0]);
  const base = path.join(f.root, 'github-base');
  await mkdir(path.join(base, 'acme'), { recursive: true });
  await g(f.root, 'clone', '--bare', source.path, path.join(base, 'acme', 'web.git'));
  const root = path.join(f.root, 'project-code');
  await withEnv({ AIDEN_GITHUB_CLONE_BASE: base }, async () => {
    const repo = await syncGithubRepository(root, { owner: 'acme', name: 'web' });
    assert.equal(repo.path, path.join(await realpath(root), 'github', 'acme', 'web'));
    assert.match(repo.id, /^repo-[0-9a-f]{16}$/);
    assert.deepEqual(repo.source, {
      kind: 'github',
      name: 'acme/web',
      url: 'https://github.com/acme/web',
    });
    assert.equal(
      await g(repo.path, 'remote', 'get-url', '--push', 'origin'),
      'no-push://aiden-read-only',
    );
    await assert.rejects(access(`${repo.path}.partial`));
    // A second connect fetches into the same clone and keeps the same identity.
    const again = await syncGithubRepository(root, { owner: 'acme', name: 'web' });
    assert.equal(again.id, repo.id);
    await assert.rejects(
      syncGithubRepository(root, { owner: 'acme', name: 'missing' }),
      /Could not clone acme\/missing\. Check the link/,
    );
    await assert.rejects(access(path.join(root, 'github', 'acme', 'missing.partial')));
    // Without a working GitHub CLI there is no second attempt, and the same clear error returns.
    const noCli = await mkdtemp(path.join(tmpdir(), 'aiden-no-gh-'));
    await writeFile(path.join(noCli, 'gh'), '#!/bin/sh\nexit 1\n');
    await chmod(path.join(noCli, 'gh'), 0o755);
    await withEnv({ PATH: `${noCli}:${process.env.PATH ?? ''}` }, () =>
      assert.rejects(
        syncGithubRepository(root, { owner: 'acme', name: 'missing' }),
        /Could not clone acme\/missing/,
      ),
    );
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(
      syncGithubRepository(root, { owner: 'acme', name: 'other' }, stopped.signal),
      { name: 'AbortError' },
    );
  });
});

void test('test listings read owners and bare repositories from the clone base', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'aiden-base-'));
  await mkdir(path.join(base, 'acme', 'web.git'), { recursive: true });
  await mkdir(path.join(base, 'acme', 'notes'), { recursive: true });
  await mkdir(path.join(base, '.cache'), { recursive: true });
  await withEnv({ AIDEN_GITHUB_CLONE_BASE: base }, async () => {
    assert.deepEqual(await listGithubAccounts(), {
      items: [{ login: 'acme', kind: 'organization' }],
    });
    const listed = await listGithubRepositories('acme');
    assert.deepEqual('items' in listed && listed.items.map((r) => r.name), ['web']);
    assert.deepEqual(await listGithubRepositories('nobody'), { items: [] });
  });
  assert.match(
    JSON.stringify(await listGithubRepositories('../acme')),
    /is not a GitHub account name/,
  );
  assert.match(
    JSON.stringify(await listGithubRepositories('.acme')),
    /is not a GitHub account name/,
  );
});

void test('the GitHub CLI lists accounts and active repositories newest first, read only', async () => {
  const dir = await fakeGh();
  const env = { AIDEN_GITHUB_CLONE_BASE: undefined, PATH: `${dir}:${process.env.PATH ?? ''}` };
  await withEnv(env, async () => {
    assert.deepEqual(await listGithubAccounts(), {
      items: [
        { login: 'sam', kind: 'user' },
        { login: 'acme', kind: 'organization' },
        { login: 'acme-labs', kind: 'organization' },
      ],
    });
    const listed = await listGithubRepositories('acme');
    assert.ok('items' in listed);
    assert.deepEqual(
      listed.items.map((r) => [r.name, r.private, r.fork, r.language, r.description]),
      [
        ['web', true, false, 'TypeScript', 'Storefront'],
        ['old', false, false, null, ''],
        ['fork', false, true, null, ''],
      ],
    );
    assert.deepEqual(await listGithubRepositories('odd'), { items: [] });
    // Folders and files are read from GitHub without cloning; odd entries and bad paths are refused.
    assert.deepEqual(await githubFolder('acme', 'web', ''), {
      items: [
        { path: 'src', type: 'dir' },
        { path: 'README.md', type: 'file' },
      ],
    });
    assert.match(JSON.stringify(await githubFolder('acme', 'web', 'one')), /is a file/);
    assert.match(
      JSON.stringify(await githubFolder('acme', 'web', 'gone')),
      /GitHub did not answer/,
    );
    assert.match(JSON.stringify(await githubFolder('acme', 'web', 'a/../b')), /not a repository/);
    assert.deepEqual(await githubFile('acme', 'web', 'README.md'), { text: '# Storefront web\n' });
    assert.match(JSON.stringify(await githubFile('acme', 'web', 'logo.png')), /not a text file/);
    assert.match(JSON.stringify(await githubFile('acme', 'web', 'gone')), /GitHub did not answer/);
    assert.match(
      JSON.stringify(await githubFile('acme', 'web', '/etc/passwd')),
      /not a repository/,
    );
    assert.match(JSON.stringify(await listGithubRepositories('gone')), /GitHub did not answer/);
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(listGithubAccounts(stopped.signal), { name: 'AbortError' });
    await assert.rejects(listGithubRepositories('acme', stopped.signal), { name: 'AbortError' });
  });
  await withEnv({ ...env, FAKE_GH_FAIL: '1' }, async () => {
    const failed = await listGithubAccounts();
    assert.ok('unavailable' in failed);
    assert.match(failed.unavailable, /gh auth login/);
    assert.doesNotMatch(failed.unavailable, /auth required/);
  });
});

void test('GitHub CLI calls find common install folders and never prompt', () => {
  const env = githubCliEnv();
  assert.ok(env.PATH?.split(':').includes('/opt/homebrew/bin'));
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  assert.equal(maxConnectedRepositories, 30);
});
