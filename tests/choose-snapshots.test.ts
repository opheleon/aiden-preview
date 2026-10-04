import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseSnapshots } from '../packages/core/src/report-analysis.js';

const sha = (c: string) => c.repeat(40);
const run = {
  project: {
    repositories: [
      { id: 'app', path: '/synthetic/app', notes: '' },
      { id: 'lib', path: '/synthetic/lib', notes: '' },
    ],
  },
} as never;

void test('delivery reads only a verified remote default while unavailable remotes retain local progress', () => {
  const chosen = chooseSnapshots(run, {
    inventory: [
      {
        repositoryId: 'app',
        notes: '',
        head: sha('b'),
        defaultBranch: 'origin/main',
        refs: [
          { repositoryId: 'app', branch: 'origin/main', sha: sha('a') },
          { repositoryId: 'app', branch: 'feature', sha: sha('b') },
          { repositoryId: 'app', branch: 'origin/feature', sha: sha('b') },
        ],
        worktrees: [sha('c'), sha('a')],
        remoteDefault: {
          remote: 'origin',
          branch: 'origin/main',
          sha: sha('e'),
          checkedAt: '2026-10-04T00:00:00.000Z',
        },
        warnings: [],
      },
      { repositoryId: 'lib', notes: '', head: sha('d'), defaultBranch: '', refs: [], warnings: [] },
    ],
  });
  assert.deepEqual(
    chosen.snapshots.map((s) => [s.repositoryId, s.sha[0], s.branch, s.role]),
    [
      ['app', 'e', 'origin/main', 'integration'],
      ['lib', 'd', 'HEAD', 'feature'],
    ],
  );
  assert.equal(chosen.snapshots[0]?.source, 'remote-branch');
  assert.equal(chosen.snapshots[1]?.source, 'local');
  assert.match(chosen.warnings[0]!, /selected remote branches/);
});
