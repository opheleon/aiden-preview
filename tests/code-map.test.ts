import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { codeMap, goalWords, layoutOf, planningSnapshots } from '../packages/core/src/code-map.js';

const now = Date.parse('2026-10-29T12:00:00Z');

/** A Git repository with these files, committed on the given day. */
async function repo(root: string, name: string, files: Record<string, string>, day: string) {
  const dir = path.join(root, name);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: `${day}T12:00:00Z`,
    GIT_COMMITTER_DATE: `${day}T12:00:00Z`,
  };
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('add', '.');
  run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'init');
  return { id: name, path: dir };
}

void test('goal words skip common words and come longest first', () => {
  assert.deepEqual(goalWords('I want to auto create Zoom meetings for calendar events'), [
    'meetings',
    'calendar',
    'create',
    'events',
    'auto',
    'zoom',
  ]);
});

void test('the layout shows two folder levels with file counts', () => {
  assert.deepEqual(layoutOf(['README.md', 'src/a.ts', 'src/views/b.tsx', 'src/views/c.tsx']), [
    'README.md',
    'src/ (3 files): a.ts, views/',
  ]);
});

void test('the plan step maps recent repositories that match the goal, at their commits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiden-code-map-'));
  const api = await repo(
    root,
    'calendar-api',
    {
      'README.md': 'Calendar API for events.',
      'package.json': JSON.stringify({
        name: 'calendar-api',
        scripts: { test: 'vitest' },
        dependencies: { googleapis: '1' },
      }),
      'src/events/create.ts': 'export const createEvent = () => {};',
    },
    '2026-10-20',
  );
  const site = await repo(root, 'website', { 'index.html': '<h1>Hello</h1>' }, '2026-10-25');
  const old = await repo(root, 'old-calendar', { 'events.js': 'calendar events' }, '2024-01-10');
  const maps = await codeMap(
    [site, old, api],
    'Auto create Zoom meetings for calendar events',
    now,
  );
  assert.deepEqual(
    maps.map((m) => m.name),
    ['calendar-api'],
    'the stale repository and the unrelated one are left out',
  );
  const [map] = maps;
  assert.equal(map?.lastChange, '2026-10-20');
  assert.equal(map?.branch, 'main');
  assert.match(map?.manifests[0]?.summary ?? '', /dependencies googleapis/);
  assert.ok(map?.related.includes('src/events/create.ts'));
  assert.deepEqual(planningSnapshots(maps), [
    {
      repositoryId: 'calendar-api',
      sha: map?.sha,
      branch: 'main',
      role: 'unknown',
      reason: 'The checked-out code, read while planning the requirements.',
      source: 'local',
    },
  ]);
});
