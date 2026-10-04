import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  codingWorktree,
  deliveryGitServices,
  github,
  githubRepository,
} from '../packages/tools/src/delivery-git.js';
import { git } from '../packages/tools/src/git.js';
import { fixture, g } from './helpers.js';

void test('coding worktrees preserve the original checkout and refuse executable filters and non-GitHub origins', async (t) => {
  const f = await fixture();
  const repo = f.project.repositories[0]!;
  try {
    await g(repo.path, 'remote', 'add', 'origin', 'https://example.com/wrong/repo');
    await assert.rejects(githubRepository(repo), /github.com origin/);
    await g(repo.path, 'remote', 'set-url', 'origin', 'git@github.com:fixture/repo.git');
    assert.equal(await githubRepository(repo), 'fixture/repo');
    t.mock.method(deliveryGitServices, 'github', () =>
      Promise.resolve({ defaultBranchRef: { name: 'main' } }),
    );
    const mutations: string[][] = [];
    t.mock.method(deliveryGitServices, 'git', (cwd: string, args: string[]) => {
      if (args[0] === 'fetch') {
        mutations.push(args);
        return Promise.resolve('');
      }
      if (args[1] === 'FETCH_HEAD^{commit}') return git(cwd, ['rev-parse', 'HEAD']);
      return git(cwd, args);
    });
    const before = await git(repo.path, ['rev-parse', 'HEAD']);
    await writeFile(path.join(repo.path, 'uncommitted.txt'), 'preserve me');
    const target = path.join(f.root, 'isolated', 'job');
    assert.deepEqual(await codingWorktree(repo, target, 'aiden/job-test'), {
      repository: 'fixture/repo',
      baseBranch: 'main',
    });
    assert.equal((await git(target, ['branch', '--show-current'])).trim(), 'aiden/job-test');
    assert.equal(await git(repo.path, ['rev-parse', 'HEAD']), before);
    assert.equal(await readFile(path.join(repo.path, 'uncommitted.txt'), 'utf8'), 'preserve me');
    assert.deepEqual(mutations[0], [
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      'origin',
      'refs/heads/main',
    ]);
    await g(repo.path, 'config', 'filter.fixture.smudge', 'false');
    await assert.rejects(
      codingWorktree(repo, path.join(f.root, 'blocked'), 'aiden/blocked'),
      /Executable checkout filters/,
    );
    assert.equal(mutations.length, 1);
    t.mock.method(deliveryGitServices, 'git', () =>
      Promise.reject(Object.assign(new Error('fixture config failure'), { code: 2 })),
    );
    await assert.rejects(codingWorktree(repo, path.join(f.root, 'broken'), 'aiden/broken'));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('GitHub reader uses argument arrays, parses bounded JSON, and hides raw command failures', async () => {
  const f = await fixture();
  const previous = process.env.PATH;
  try {
    const bin = path.join(f.root, 'bin');
    await mkdir(bin);
    await writeFile(
      path.join(bin, 'gh'),
      `#!${process.execPath}\nif(process.argv[2]==='fail'){process.stderr.write('private diagnostic');process.exit(2);}process.stdout.write(JSON.stringify({args:process.argv.slice(2),noninteractive:process.env.GH_PROMPT_DISABLED}));`,
      { mode: 0o700 },
    );
    process.env.PATH = `${bin}${path.delimiter}${previous ?? ''}`;
    assert.deepEqual(await github(['pr', 'view', 'literal;not-a-shell-command']), {
      args: ['pr', 'view', 'literal;not-a-shell-command'],
      noninteractive: '1',
    });
    await assert.rejects(
      github(['fail']),
      (error: Error) =>
        error.message.includes('Could not read GitHub') &&
        !error.message.includes('private diagnostic'),
    );
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
    await rm(f.root, { recursive: true, force: true });
  }
});
