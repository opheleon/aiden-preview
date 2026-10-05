import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import { runTitle } from '../../apps/desktop/src/renderer/run-labels';
import type { ActivityEntry } from '../../packages/contracts/src/index';
import { appFixture, openCall } from './app-fixture';
import { report } from './fixtures';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
beforeEach(() => f.reset());

/** A synthetic step or decision in a run's history; not recorded agent output. */
const entry = (summary: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  at: report.generatedAt,
  runId: 'live-run',
  kind: 'step',
  summary,
  ...extra,
});

test('the runs list shows work in progress live, and a run opens its full history', async () => {
  f.startRun({ id: 'live-run', kind: 'report', reason: 'commit' }, [
    entry('Looking at the code against what done means.', {
      kind: 'look',
      reason: 'Two new commits landed.',
    }),
    entry('Syncing your repositories'),
    entry('Read frontend/app.txt from line 1'),
  ]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Runs/ }));
  const list = await screen.findByRole('region', { name: 'All runs' });
  const live = within(list).getByRole('button', { name: /Checking the code/ });
  expect(live).toHaveTextContent('Now: Read frontend/app.txt from line 1');
  expect(live).toHaveTextContent('Running');
  expect(within(list).getByRole('button', { name: /Checked the code/ })).toHaveTextContent('Done');

  await userEvent.click(live);
  expect(await screen.findByRole('heading', { name: 'Checking the code' })).toBeVisible();
  const stages = screen.getByRole('list', { name: 'Stages' });
  expect(within(stages).getByText('Check the code').closest('li')).toHaveClass('stage--now');
  expect(within(stages).getByText('Sync repositories').closest('li')).toHaveClass('stage--done');
  const history = await screen.findByRole('region', { name: 'Full history' });
  expect(await within(history).findByText('Read frontend/app.txt from line 1')).toBeVisible();
  expect(screen.getByText(/Now: Read frontend\/app\.txt from line 1/)).toBeVisible();

  act(() =>
    f.emit({
      type: 'activity',
      projectId: report.projectId,
      runId: 'live-run',
      activity: entry('Searched backend for "/books"', { at: new Date().toISOString() }),
    }),
  );
  expect(within(history).getByText('Searched backend for "/books"')).toBeVisible();
  expect(screen.getByText(/Now: Searched backend for "\/books"/)).toBeVisible();
  expect(
    within(history).queryByRole('button', { name: 'Why: Syncing your repositories' }),
  ).toBeNull();
  await userEvent.click(
    within(history).getByRole('button', {
      name: 'Why: Looking at the code against what done means.',
    }),
  );
  expect(await screen.findByText('Two new commits landed.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(f.request).toHaveBeenCalledWith('cancel', { runId: 'live-run' });
  await userEvent.click(screen.getByRole('button', { name: 'All runs' }));
  expect(await screen.findByRole('region', { name: 'All runs' })).toBeVisible();
});

test('the brief links to the run in progress', async () => {
  f.startRun({ id: 'live-run', kind: 'report' }, [entry('Read frontend/app.txt from line 1')]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Watch it work' }));
  expect(await screen.findByRole('heading', { name: 'Checking the code' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'All runs' }));
  await userEvent.click(screen.getByRole('button', { name: /Book|Synthetic books/ }));
  expect(await screen.findByRole('region', { name: 'Status' })).toBeVisible();
});

test('blocked runs explain the missing information and accept an answer in place', async () => {
  f.setCalls([openCall({ requirementId: null, runId: report.id, blocking: true })]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Runs/ }));
  const list = await screen.findByRole('region', { name: 'All runs' });
  const run = within(list).getByRole('button', { name: /Checked the code/ });
  expect(run).toHaveTextContent('Blocked');
  expect(run).not.toHaveTextContent('Done');
  expect(run).toHaveTextContent('Can two books share a title?');
  await userEvent.click(run);
  const decisions = screen.getByRole('region', { name: 'Waiting for information' });
  expect(within(decisions).getByText(/Answering updates the scope/)).toBeVisible();
  await userEvent.click(within(decisions).getByRole('button', { name: 'Block duplicates' }));
  expect(f.request).not.toHaveBeenCalledWith('answerCall', expect.anything());
  await userEvent.click(within(decisions).getByRole('button', { name: 'Answer' }));
  expect(f.request).toHaveBeenCalledWith('answerCall', {
    projectId: report.projectId,
    callId: 'call-1',
    answer: 'Block duplicates',
  });
  expect(screen.queryByRole('region', { name: 'Waiting for information' })).toBeNull();
});

test('the stage tracker follows progress events between full refreshes', async () => {
  f.startRun({ id: 'live-run', kind: 'report', stage: 'sync' }, [
    entry('Syncing your repositories'),
  ]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Runs/ }));
  const list = await screen.findByRole('region', { name: 'All runs' });
  await userEvent.click(within(list).getByRole('button', { name: /Checking the code/ }));
  const stages = await screen.findByRole('list', { name: 'Stages' });
  expect(within(stages).getByText('Sync repositories').closest('li')).toHaveClass('stage--now');
  for (const stage of ['discover', 'assess'] as const)
    await act(async () => {
      f.emit({
        type: 'progress',
        projectId: report.projectId,
        runId: 'live-run',
        stage,
        message: `${stage}…`,
      });
      await Promise.resolve();
    });
  expect(within(stages).getByText('Choose commits').closest('li')).toHaveClass('stage--done');
  expect(within(stages).getByText('Check the code').closest('li')).toHaveClass('stage--now');
});

test('stopped and failed runs are titled by their outcome', () => {
  const run = { ...report, kind: 'report', status: 'completed', stage: 'complete' } as never;
  const make = (extra: object) =>
    ({ ...(run as object), ...extra }) as Parameters<typeof runTitle>[0];
  expect(runTitle(make({}), false)).toBe('Checked the code');
  expect(runTitle(make({}), true)).toBe('Checking the code');
  expect(runTitle(make({ status: 'cancelled' }), false)).toBe('Checking the code stopped');
  expect(runTitle(make({ status: 'failed', kind: 'prepare' }), false)).toBe(
    'Writing requirements failed',
  );
  expect(
    runTitle(make({ status: 'cancelled', beta: { revision: 'abc', url: 'https://x' } }), false),
  ).toBe('Checking beta stopped');
});
