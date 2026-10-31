import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import { copyNamedCode } from '../packages/core/src/find-code.js';
import { Store } from '../packages/core/src/storage.js';
import { githubBrowseTools } from '../packages/tools/src/github-browse.js';
import { fixture, g } from './helpers.js';
import { required } from './required.js';

/** A fake GitHub of bare repositories: acme/web holds the fixture's frontend. */
async function fakeGithub() {
  const f = await fixture();
  const base = path.join(f.root, 'github-base');
  await mkdir(path.join(base, 'acme'), { recursive: true });
  const source = required(f.project.repositories[0]);
  await g(f.root, 'clone', '--bare', source.path, path.join(base, 'acme', 'web.git'));
  process.env.AIDEN_GITHUB_CLONE_BASE = base;
  return f;
}

/** Run one browse tool by name. */
function browse(tools: ReturnType<typeof githubBrowseTools>, name: string, input: unknown) {
  return required(tools.find((tool) => tool.name === name)).run(input);
}

void test('planning browses only the project organization on GitHub, read-only', async () => {
  await fakeGithub();
  try {
    const tools = githubBrowseTools(['acme']);
    assert.deepEqual(await browse(tools, 'github_repositories', { owner: 'acme' }), {
      items: [
        {
          name: 'web',
          description: '',
          private: true,
          fork: false,
          language: null,
          pushedAt: null,
        },
      ],
    });
    const top = (await browse(tools, 'github_files', { repository: 'acme/web' })) as {
      items: { path: string; type: string }[];
    };
    assert.ok(top.items.some((entry) => entry.path === 'app.txt' && entry.type === 'file'));
    assert.deepEqual(
      await browse(tools, 'github_read', { repository: 'acme/web', path: 'app.txt' }),
      {
        text: 'GET /books\nrender list\n',
      },
    );
    assert.match(
      JSON.stringify(await browse(tools, 'github_read', { repository: 'acme/web', path: '../x' })),
      /not a repository file/,
    );
    assert.throws(
      () => browse(tools, 'github_files', { repository: 'other/web' }),
      /not one of this project's GitHub organizations/,
    );
  } finally {
    delete process.env.AIDEN_GITHUB_CLONE_BASE;
  }
});

void test('after planning, the repositories it named in the organization are copied and saved', async () => {
  const f = await fakeGithub();
  try {
    const store = new Store(path.join(f.root, 'data'));
    const project = {
      ...f.project,
      repositories: [],
      githubOrganizations: ['acme'],
    };
    await mkdir(store.project(project.id), { recursive: true });
    await writeFile(path.join(store.project(project.id), 'project.json'), JSON.stringify(project));
    const events: RunEvent[] = [];
    const run = {
      id: 'run-1',
      projectId: project.id,
      stage: 'understand',
      project,
    } as unknown as RunManifest;
    await copyNamedCode(
      { store, emit: (event: RunEvent) => events.push(event) } as never,
      run,
      ['acme/web', 'other/api', 'not a repository'],
      new AbortController().signal,
    );
    assert.deepEqual(
      run.project.repositories.map((r) => r.source?.name),
      ['acme/web'],
      'only the organization repository is copied',
    );
    const saved = JSON.parse(
      await readFile(path.join(store.project(project.id), 'project.json'), 'utf8'),
    ) as { repositories: { source?: { name: string } }[] };
    assert.deepEqual(
      saved.repositories.map((r) => r.source?.name),
      ['acme/web'],
    );
    assert.equal(events[0]?.message, 'Copying acme/web read-only');
  } finally {
    delete process.env.AIDEN_GITHUB_CLONE_BASE;
  }
});
