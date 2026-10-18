import { expect, test } from 'vitest';

import { monitoringLabel } from '../../apps/desktop/src/views/BriefHeader';

const repo = (path: string, branch?: string) => ({
  id: path,
  path,
  notes: '',
  ...(branch ? { monitoredBranch: { remote: 'origin', branch } } : {}),
});

test('the monitoring line names each repository only when a project has several', () => {
  expect(monitoringLabel([repo('/src/app', 'release')])).toBe('origin/release');
  expect(monitoringLabel([repo('/src/vite'), repo('/src/rolldown')])).toBe('not configured');
  expect(monitoringLabel([repo('/src/rolldown', 'main'), repo('/src/vite', 'main')])).toBe(
    'rolldown on origin/main, vite on origin/main',
  );
  expect(monitoringLabel([repo('/src/rolldown', 'main'), repo('/src/vite')])).toBe(
    'rolldown on origin/main, vite not configured',
  );
});
