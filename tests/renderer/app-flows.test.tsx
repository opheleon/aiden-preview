import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ActivityEntry } from '../../packages/contracts/src/index';
import { appFixture, openCall } from './app-fixture';
import { report } from './fixtures';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
beforeEach(() => f.reset());

async function openProject() {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await screen.findByRole('region', { name: 'Requirements' });
}

/** Open the overflow menu and pick one item. */
async function menu(item: string) {
  await userEvent.click(screen.getByLabelText('More'));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

/** A synthetic action-log line; not recorded agent output. */
function line(summary: string, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  return { at: report.generatedAt, runId: report.id, kind: 'look', summary, ...extra };
}

test('setting the intent is one screen, and Aiden starts without a review step', async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Create project' }));
  expect(screen.getByRole('heading', { name: /What are you building/ })).toBeVisible();
  const start = screen.getByRole('button', { name: /Hand it to Aiden/ });
  expect(start).toBeDisabled();
  await userEvent.type(screen.getByLabelText('What are you building?'), 'List books');
  await userEvent.click(screen.getByRole('button', { name: 'Import a file' }));
  expect(screen.getByLabelText('What are you building?')).toHaveValue(
    'List books\n\nImported fixture intent',
  );
  expect(start).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Choose the project folder' }));
  expect(await screen.findByRole('button', { name: 'synthetic · 1 repository' })).toBeVisible();
  expect(screen.getByText('Synthetic discovery warning')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Model provider'), 'claude');
  await userEvent.click(start);
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith('prepare', {
      autoAccept: true,
      project: expect.objectContaining({
        name: 'List books Imported fixture intent',
        context: 'List books\n\nImported fixture intent',
        runtime: { provider: 'claude', auth: 'subscription' },
      }),
    }),
  );
  expect(await screen.findByText('Aiden is writing the requirements.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
});

test('a project whose first rewrite is running shows it, and a stopped one says so', async () => {
  f.reset(false);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  expect(await screen.findByText('Aiden is writing the requirements.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(f.request).toHaveBeenCalledWith('cancel', { runId: 'prepare-run' });
  act(() =>
    f.emit({
      type: 'cancelled',
      projectId: report.projectId,
      runId: 'prepare-run',
      message: 'Run cancelled or timed out.',
    }),
  );
  expect(await screen.findByText('Aiden could not write the requirements.')).toBeVisible();
  expect(screen.getByText('It was stopped before it finished.')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(f.request).toHaveBeenCalledWith('editIntent', {
    projectId: report.projectId,
    context: 'Users can list and create books',
  });
});

test('the brief keeps only touch points on screen; the rest lives in one menu', async () => {
  await openProject();
  for (const name of ['Refresh status', 'Schedule', 'App URL', 'Markdown', 'Check now'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  await menu('Export Markdown');
  expect(screen.getByLabelText('More').closest('details')).not.toHaveAttribute('open');
  expect(f.api.saveExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'markdown' }));
  expect(await screen.findByText('Markdown report exported.')).toBeVisible();
  await menu('Export JSON');
  expect(f.api.saveExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'json' }));
  await menu('Run check now');
  expect(f.request).toHaveBeenCalledWith('look', { projectId: report.projectId });
  expect(await screen.findByText('Starting a check…')).toBeVisible();
  act(() =>
    f.emit({ type: 'progress', projectId: report.projectId, runId: 'look-run', message: 'Sync…' }),
  );
  expect(screen.getByText('Sync…')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(f.request).toHaveBeenCalledWith('cancel', { runId: 'look-run' });
  await menu('Project settings');
  expect(await screen.findByRole('region', { name: 'App URL settings' })).toBeVisible();
});

test('action items: PM decisions are answered in place, Dev items copy a prompt, manual tests are marked done', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  f.setCalls([
    openCall({ blocking: false }),
    openCall({
      id: 'call-2',
      kind: 'app-url',
      requirementId: null,
      question: 'Where does your app run?',
      options: [],
      assumption: 'Checking the code only until the app is running.',
    }),
    openCall({
      id: 'call-3',
      blocking: false,
      requirementId: 'REQ-1',
      edgeCaseId: 'E1',
      owner: 'someone else',
      question: 'What should an empty library say?',
      options: [],
      assumption: 'No books yet.',
    }),
    openCall({ id: 'call-4', status: 'answered', question: 'Already decided?' }),
  ]);
  f.setReport({
    ...report,
    assessments: report.assessments.map((a) =>
      a.requirementId === 'REQ-2' ? { ...a, status: 'unknown', unknowns: ['No server'] } : a,
    ),
  });
  await openProject();
  const actions = screen.getByRole('region', { name: 'Needs you' });
  expect(actions).toHaveTextContent('Needs you · 3');
  await userEvent.click(screen.getByText('Users can list books.', { selector: '.row-title' }));
  await userEvent.click(screen.getByText('Users can create books.', { selector: '.row-title' }));
  expect(actions).not.toHaveTextContent('Already decided?');
  const items = [
    ...within(actions).getAllByRole('listitem'),
    ...screen
      .getAllByRole('region', { name: 'Action items' })
      .flatMap((region) => within(region).getAllByRole('listitem')),
  ];
  expect(items.map((item) => item.querySelector('.chip')?.textContent)).toEqual([
    'PM',
    'PM',
    'PM',
    'Dev',
    'PM',
  ]);
  expect(items[0]).toHaveTextContent('Decide: Can two books share a title?');
  expect(items[0]).toHaveTextContent('Reversible assumption: Allow duplicates');
  expect(items[1]).toHaveTextContent('Tell Aiden where your app runs');
  expect(items[3]).toHaveTextContent('Finish: Users can list books.');
  expect(items[4]).toHaveTextContent('Test by hand: Users can create books.');
  await userEvent.click(within(actions).getByRole('button', { name: 'Block duplicates' }));
  expect(f.request).toHaveBeenCalledWith('answerCall', {
    projectId: report.projectId,
    callId: 'call-1',
    answer: 'Block duplicates',
  });
  expect(await screen.findByText('Using your answer…')).toBeVisible();
  const where = screen.getByLabelText('Other answer to Where does your app run?');
  expect(where).toHaveAttribute('placeholder', 'http://localhost:3000');
  await userEvent.type(where, 'http://localhost:3000{Enter}');
  expect(f.request).toHaveBeenCalledWith('answerCall', {
    projectId: report.projectId,
    callId: 'call-2',
    answer: 'http://localhost:3000',
  });
  expect(
    await screen.findByText('Got it. Aiden will use this as soon as its current work finishes.'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Copy the question' }));
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining('What should an empty library say?'),
  );
  expect(screen.getByText(/On Teams, Aiden takes this to them/)).toBeVisible();
  await userEvent.click(within(items[3]!).getByRole('button', { name: 'Copy work item' }));
  expect(writeText).toHaveBeenLastCalledWith(
    expect.stringMatching(/Finish: Users can list books\. \(REQ-1\)[\s\S]*What the code shows:/),
  );
  await userEvent.click(within(items[4]!).getByRole('button', { name: 'Done' }));
  expect(f.request).toHaveBeenCalledWith('confirmAction', {
    projectId: report.projectId,
    key: 'REQ-2',
    reportId: report.id,
  });
  await waitFor(() => expect(actions).not.toHaveTextContent('Test by hand'));
});

test('Why? opens the run conversation: the logged reason first, then questions answered from the record', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  /** A time some minutes before the report, so older runs sort after it. */
  const earlier = (minutes: number) =>
    new Date(Date.parse(report.generatedAt) - minutes * 60000).toISOString();
  f.setActivity([
    line('REQ-1 is only partly built in the code.', { kind: 'find', reason: 'The routes differ.' }),
    line('Checked the code against what done means.', {
      reconstructed: true,
      runId: 'old-run',
      at: earlier(1),
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      line(`Older step ${i}`, { kind: 'check', runId: `run-${i}`, at: earlier(i + 2) }),
    ),
  ]);
  await openProject();
  await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));
  const log = screen.getByRole('region', { name: 'Activity' });
  expect(within(log).getByRole('button', { name: 'Checked the code' })).toBeVisible();
  await userEvent.click(
    within(log).getByRole('button', { name: 'Why: REQ-1 is only partly built in the code.' }),
  );
  expect(f.request).toHaveBeenCalledWith('explain', {
    projectId: report.projectId,
    runId: report.id,
    at: report.generatedAt,
    summary: 'REQ-1 is only partly built in the code.',
  });
  const chat = await within(log).findByLabelText('Ask about this run', { selector: 'div' });
  expect(await within(chat).findByText('The routes differ.')).toBeVisible();
  expect(within(chat).getByText(/From the run log/)).toBeVisible();
  const input = within(chat).getByRole('textbox', { name: 'Ask about this run' });
  await userEvent.type(input, 'Why only partly?{Enter}');
  expect(f.request).toHaveBeenCalledWith('askWhy', {
    projectId: report.projectId,
    runId: report.id,
    question: 'Why only partly?',
  });
  expect(await within(chat).findByText('Synthetic answer from the run record.')).toBeVisible();
  expect(input).toHaveValue('');
  await userEvent.type(input, 'fail{Enter}');
  expect(await within(chat).findByRole('alert')).toHaveTextContent('Aiden could not answer.');
  expect(within(log).getByText(/Rebuilt from saved history/)).toBeVisible();
  expect(within(log).queryByText('Older step 8')).toBeNull();
  await userEvent.click(within(log).getByRole('button', { name: 'Show earlier' }));
  expect(within(log).getByText('Older step 8')).toBeVisible();
  await userEvent.click(within(log).getAllByRole('button', { name: /Ask about this/ })[1]!);
  expect(f.request).toHaveBeenCalledWith('chat', { projectId: report.projectId, runId: 'old-run' });
  await userEvent.click(within(log).getByRole('button', { name: 'Copy update' }));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('0 of 2 requirements done.'));
  act(() =>
    f.emit({
      type: 'activity',
      projectId: report.projectId,
      runId: 'look-run',
      activity: line('Found your app running at http://localhost:5173/.', { kind: 'decide' }),
    }),
  );
  expect(
    within(log).getAllByText('Found your app running at http://localhost:5173/.'),
  ).toHaveLength(1);
});

test('what done means stays editable, and editing it makes Aiden look again', async () => {
  f.setBaseline({
    id: report.baselineId,
    projectId: report.projectId,
    contextHash: 'a'.repeat(64),
    product: {
      ...report.baseline,
      requirements: [
        {
          ...report.baseline.requirements[0]!,
          edgeCases: [{ id: 'E1', text: 'An empty library says so.', origin: 'found' }],
        },
        report.baseline.requirements[1]!,
      ],
    },
    reviewedAt: report.generatedAt,
    retiredIds: ['REQ-7'],
  });
  await openProject();
  await userEvent.click(screen.getByRole('tab', { name: 'Scope' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit scope' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit scope' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove REQ-1 E1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove REQ-2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
  const save = screen.getByRole('button', { name: 'Save and run check' });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText('REQ-8'), 'Export books');
  await userEvent.type(screen.getByLabelText('REQ-1'), ' fast');
  await userEvent.click(save);
  expect(f.request).toHaveBeenCalledWith('editIntent', {
    projectId: report.projectId,
    product: expect.objectContaining({
      requirements: [
        { id: 'REQ-1', text: 'Users can list books. fast', edgeCases: [] },
        { id: 'REQ-8', text: 'Export books' },
      ],
    }),
  });
  expect(await screen.findByText('Running a check…')).toBeVisible();
  act(() => f.emit({ type: 'completed', projectId: report.projectId, runId: 'intent-run' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit goal' }));
  const intent = screen.getByLabelText('What you are building');
  expect(screen.getByRole('button', { name: 'Rewrite requirements' })).toBeDisabled();
  await userEvent.type(intent, ' and delete them');
  await userEvent.click(screen.getByRole('button', { name: 'Rewrite requirements' }));
  expect(f.request).toHaveBeenCalledWith('editIntent', {
    projectId: report.projectId,
    context: 'Users can list and create books and delete them',
  });
  expect(await screen.findByText('Rewriting the requirements…')).toBeVisible();
});

test('code evidence, support, and a fresh project stay one click away', async () => {
  await openProject();
  await userEvent.click(screen.getAllByText('In the code')[0]!);
  await userEvent.click(screen.getAllByRole('button', { name: /frontend · app.txt:1/ })[0]!);
  expect(await screen.findByRole('dialog', { name: 'Code evidence' })).toHaveTextContent(
    'GET /books',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
  await userEvent.click(screen.getByRole('button', { name: 'Feedback & support' }));
  expect(f.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('join.slack.com'));
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
  expect(screen.getByLabelText('What are you building?')).toHaveValue('');
});

test('project settings hold the folder, the app URL, and context connections', async () => {
  await openProject();
  await menu('Project settings');
  const panel = await screen.findByRole('region', { name: 'App URL settings' });
  expect(await within(panel).findByRole('status')).toHaveTextContent('No app URL saved.');
  expect(within(panel).queryByRole('button', { name: 'Check now' })).toBeNull();
  const input = within(panel).getByLabelText('App URL');
  await userEvent.type(input, 'file:///etc/passwd');
  await userEvent.click(within(panel).getByRole('button', { name: 'Save URL' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    /^Only http and https URLs can be verified\.$/,
  );
  await userEvent.clear(input);
  await userEvent.type(input, 'https://beta.example.test');
  await userEvent.click(within(panel).getByRole('button', { name: 'Save URL' }));
  expect(within(panel).getByRole('status')).toHaveTextContent('Saved: https://beta.example.test');
  await userEvent.click(within(panel).getByRole('button', { name: 'Clear' }));
  expect(f.request).toHaveBeenLastCalledWith('updateVerificationSettings', {
    projectId: report.projectId,
    url: null,
  });
  await userEvent.type(screen.getByLabelText('Branch notes for frontend'), ' reviewed');
  await userEvent.click(screen.getByRole('button', { name: 'Rescan folder' }));
  expect(screen.getByLabelText('Branch notes for frontend')).toHaveValue('main reviewed');
  await userEvent.click(screen.getByRole('button', { name: 'Save and run check' }));
  expect(f.request).toHaveBeenCalledWith('prepare', {
    autoAccept: true,
    project: expect.objectContaining({
      repositories: [expect.objectContaining({ notes: 'main reviewed' })],
    }),
  });
});

test('model, integration, privacy, and update settings use the selected saved project', async () => {
  await openProject();
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
  expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Model' }));
  await userEvent.click(screen.getByText('Enter a model ID'));
  await userEvent.type(screen.getByLabelText('Model ID'), 'custom-model');
  await userEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  expect(f.request).toHaveBeenCalledWith(
    'updateRuntime',
    expect.objectContaining({ runtime: expect.objectContaining({ model: 'custom-model' }) }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Integrations' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Synthetic MCP');
  await userEvent.type(screen.getByLabelText('Server URL'), 'https://example.invalid/mcp');
  await userEvent.selectOptions(screen.getByLabelText('Authentication'), 'bearer');
  await userEvent.type(screen.getByLabelText('Bearer token'), 'synthetic-token');
  await userEvent.click(screen.getByLabelText('Use session-only authentication'));
  await userEvent.click(screen.getByRole('button', { name: 'Add server' }));
  expect(f.request).toHaveBeenCalledWith(
    'integrationAdd',
    expect.objectContaining({ bearer: 'synthetic-token', sessionOnly: true }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Connect / test' }));
  await userEvent.click(screen.getByRole('button', { name: 'Review tools' }));
  expect(screen.getByRole('checkbox', { name: /delete_issue/ })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: /list_issues/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save read tools' }));
  expect(f.request).toHaveBeenCalledWith('integrationApprove', {
    connectionId: 'connection-0',
    tools: [],
    fingerprint: 'reviewed-tools',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Project' }));
  const sources = await screen.findByRole('region', { name: 'Context connections' });
  await userEvent.click(within(sources).getByRole('checkbox', { name: 'Synthetic MCP' }));
  await userEvent.click(within(sources).getByRole('checkbox', { name: 'Synthetic MCP' }));
  await userEvent.click(within(sources).getByRole('checkbox', { name: 'Synthetic MCP' }));
  await userEvent.click(within(sources).getByRole('button', { name: 'Save connections' }));
  expect(f.request).toHaveBeenCalledWith('updateSources', {
    projectId: report.projectId,
    sources: { contextConnectionIds: ['connection-0'], history: null },
  });
  expect(await screen.findByText(/Context connections saved/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Integrations' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove Synthetic MCP' }));
  expect(f.request).toHaveBeenCalledWith('integrationRemove', { connectionId: 'connection-0' });
  await userEvent.click(screen.getByRole('button', { name: 'Preferences' }));
  expect(screen.getByText(/does not collect usage metrics/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Desktop app' }));
  expect(screen.getByText(/available in the installed desktop app/)).toBeVisible();
});

test('browser checks started from the CLI never hold the brief as active work', async () => {
  f.addVerificationRun('running');
  await openProject();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});

test('a first look that failed says why and offers Look again instead of three messages', async () => {
  f.clearRuns();
  f.addRun({
    id: 'failed-look',
    kind: 'report',
    status: 'failed',
    error: 'Aiden could not choose which code to look at: the model answer was still invalid.',
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  expect(await screen.findByText("The first check didn't finish.")).toBeVisible();
  expect(screen.getByText(/could not choose which code to look at/)).toBeVisible();
  expect(screen.queryByText('No look finished yet.')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Run check again' }));
  expect(f.request).toHaveBeenCalledWith('look', { projectId: report.projectId });
  act(() =>
    f.emit({
      type: 'failed',
      projectId: report.projectId,
      runId: report.id,
      message: 'The code assessment finished, but the browser check could not start.',
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('browser check could not start');
});

test('a later look that stopped keeps the last brief and says so', async () => {
  f.addRun({ id: 'closed-look', kind: 'report', status: 'running' });
  await openProject();
  expect(
    screen.getByText(/latest check didn't finish, so this is from the one before/),
  ).toHaveTextContent('Paused while Aiden was closed. On Teams, it keeps going.');
  expect(screen.getByText('0 of 2 requirements complete')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Run check again' }));
  expect(f.request).toHaveBeenCalledWith('look', { projectId: report.projectId });
});

test('a scope rewrite updates the project heading and sidebar without reopening it', async () => {
  await openProject();
  f.setBaseline({
    id: report.baselineId,
    projectId: report.projectId,
    contextHash: 'a'.repeat(64),
    product: { ...report.baseline, title: 'Share reading lists' },
    reviewedAt: report.generatedAt,
    retiredIds: [],
  });
  await act(async () => {
    f.emit({ type: 'completed', projectId: report.projectId, runId: 'rewrite' });
    await Promise.resolve();
  });
  expect(await screen.findByRole('heading', { name: 'Share reading lists' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Share reading lists' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
