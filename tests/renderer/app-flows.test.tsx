import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import { appFixture } from './app-fixture';
import { report } from './fixtures';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
beforeEach(() => f.reset());
async function openProject() {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await screen.findByRole('region', { name: 'Requirement status' });
}

test('saved projects expose accepted reports, evidence, exports, support, and a fresh workspace', async () => {
  await openProject();
  expect(screen.getByRole('heading', { name: 'Project activity' })).toBeVisible();
  await userEvent.click(screen.getAllByText('Code evidence')[0]!);
  await userEvent.click(screen.getAllByRole('button', { name: /frontend · app.txt:1/ })[0]!);
  expect(await screen.findByRole('dialog', { name: 'Code evidence' })).toHaveTextContent(
    'GET /books',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Markdown' })[0]!);
  expect(f.api.saveExport).toHaveBeenCalledWith(
    expect.objectContaining({ format: 'markdown', includeEstimates: true }),
  );
  expect(await screen.findByText('Markdown report exported.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  await userEvent.click(screen.getAllByRole('button', { name: 'JSON' })[0]!);
  expect(f.api.saveExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'json' }));
  await userEvent.click(screen.getByRole('button', { name: 'Feedback & support' }));
  expect(f.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('join.slack.com'));
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
  expect(screen.getByLabelText('Project description')).toHaveValue('');
});

test('project setup, review, clarification, and cancellation follow explicit user decisions', async () => {
  render(<App />);
  await userEvent.type(screen.getByLabelText('Project description'), 'List books');
  await userEvent.click(
    within(screen.getByRole('main')).getByRole('button', { name: 'Create project' }),
  );
  await userEvent.type(screen.getByLabelText('Project name'), 'New books');
  await userEvent.click(screen.getByRole('button', { name: 'Choose project folder' }));
  expect(await screen.findByTestId('discovered-repository')).toBeVisible();
  await userEvent.type(screen.getByLabelText('Branch notes for frontend'), ' reviewed');
  await userEvent.click(screen.getByRole('button', { name: 'Rescan folder' }));
  expect(screen.getByLabelText('Branch notes for frontend')).toHaveValue('main reviewed');
  await userEvent.click(screen.getByRole('button', { name: 'Add project context' }));
  await userEvent.click(screen.getByRole('button', { name: 'Import file' }));
  expect(screen.getByLabelText('Project context')).toHaveValue(
    'List books\n\nImported fixture intent',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Prepare requirements' }));
  await waitFor(() => expect(f.request).toHaveBeenCalledWith('prepare', expect.anything()));
  act(() =>
    f.emit({
      type: 'clarification',
      runId: 'prepare-run',
      questionId: 'q',
      question: 'Which users?',
    }),
  );
  expect(screen.getByLabelText('Clarification answer')).toHaveFocus();
  await userEvent.type(screen.getByLabelText('Clarification answer'), 'All users');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(f.request).toHaveBeenCalledWith('answer', {
    runId: 'prepare-run',
    questionId: 'q',
    answer: 'All users',
  });
  act(() => f.emit({ type: 'review', runId: 'prepare-run', product: report.baseline }));
  await userEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
  await userEvent.type(screen.getByLabelText('REQ-3'), 'Export books');
  await userEvent.click(screen.getByRole('button', { name: 'Remove REQ-2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Approve & run analysis' }));
  await waitFor(() => expect(f.request).toHaveBeenCalledWith('report', expect.anything()));
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(f.request).toHaveBeenCalledWith('cancel', { runId: 'analysis-run' });
  await act(async () => {
    f.emit({ type: 'cancelled', runId: 'analysis-run', message: 'Cancelled fixture' });
    await Promise.resolve();
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Cancelled fixture');
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('model, schedule, privacy, and update settings use the selected saved project', async () => {
  await openProject();
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
  await userEvent.click(screen.getByRole('button', { name: 'Model' }));
  await userEvent.click(screen.getByText('Enter a model ID'));
  await userEvent.type(screen.getByLabelText('Model ID'), 'custom-model');
  await userEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  expect(f.request).toHaveBeenCalledWith(
    'updateRuntime',
    expect.objectContaining({ runtime: expect.objectContaining({ model: 'custom-model' }) }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
  await userEvent.click(await screen.findByLabelText('Enable local schedule'));
  await userEvent.selectOptions(screen.getByLabelText('Schedule frequency'), 'weekly');
  await userEvent.selectOptions(screen.getByLabelText('Schedule weekday'), '2');
  await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(f.api.setSchedule).toHaveBeenCalledWith(
    report.projectId,
    expect.objectContaining({ enabled: true, frequency: 'weekly', weekday: 2 }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Preferences' }));
  expect(screen.getByText(/does not collect usage metrics/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Desktop app' }));
  expect(screen.getByText(/available in the installed desktop app/)).toBeVisible();
});

test('each project sets its own app URL from its overview, not application settings', async () => {
  await openProject();
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
  expect(screen.queryByRole('button', { name: 'Verification' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Synthetic books' }));
  const toggle = await screen.findByRole('button', { name: 'App URL' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(toggle);
  const panel = screen.getByRole('region', { name: 'App URL settings' });
  expect(within(panel).getByRole('heading', { name: 'App URL for Synthetic books' })).toBeVisible();
  expect(await within(panel).findByRole('status')).toHaveTextContent('No app URL saved.');
  const input = within(panel).getByLabelText('App URL');
  await userEvent.type(input, 'file:///etc/passwd');
  await userEvent.click(within(panel).getByRole('button', { name: 'Save URL' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    /^Only http and https URLs can be verified\.$/,
  );
  await userEvent.clear(input);
  await userEvent.type(input, 'https://beta.example.test');
  await userEvent.click(within(panel).getByRole('button', { name: 'Save URL' }));
  expect(f.request).toHaveBeenCalledWith('updateVerificationSettings', {
    projectId: report.projectId,
    url: 'https://beta.example.test',
  });
  expect(within(panel).getByRole('status')).toHaveTextContent('Saved: https://beta.example.test');
  expect(
    within(panel).getByText(/Each status refresh also tests every approved requirement/),
  ).toBeVisible();
  expect(panel).not.toHaveTextContent('pnpm cli');
  await userEvent.click(within(panel).getByRole('button', { name: 'Clear' }));
  expect(f.request).toHaveBeenLastCalledWith('updateVerificationSettings', {
    projectId: report.projectId,
    url: null,
  });
  expect(within(panel).getByRole('status')).toHaveTextContent('No app URL saved.');
  await userEvent.click(toggle);
  expect(screen.queryByRole('region', { name: 'App URL settings' })).not.toBeInTheDocument();
});

test('refresh status assesses the code and then checks the saved app URL in a browser', async () => {
  await openProject();
  expect(screen.queryByLabelText('Run type')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Refresh status/ }));
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith('report', {
      projectId: report.projectId,
      browserCheck: true,
    }),
  );
  expect(await screen.findByRole('button', { name: /Refreshing/ })).toBeDisabled();
  expect(f.request).not.toHaveBeenCalledWith('verify', expect.anything());
  expect(f.request).not.toHaveBeenCalledWith('estimate', expect.anything());
});

test('Check now runs only the browser check and opens its recorded report', async () => {
  await openProject();
  await userEvent.click(screen.getByRole('button', { name: 'App URL' }));
  const panel = screen.getByRole('region', { name: 'App URL settings' });
  expect(await within(panel).findByRole('status')).toHaveTextContent('No app URL saved.');
  expect(within(panel).queryByRole('button', { name: 'Check now' })).toBeNull();
  await userEvent.type(within(panel).getByLabelText('App URL'), 'http://localhost:5173');
  await userEvent.click(within(panel).getByRole('button', { name: 'Save URL' }));
  await within(panel).findByText('Saved: http://localhost:5173');
  expect(within(panel).getByText('No browser check yet.')).toBeVisible();
  await userEvent.click(within(panel).getByRole('button', { name: 'Check now' }));
  expect(f.request).toHaveBeenCalledWith('verify', { projectId: report.projectId });
  expect(
    await screen.findByRole('heading', { name: 'Checking the app in a browser' }),
  ).toBeVisible();
  expect(screen.getByText('Opening http://localhost:5173 in a browser…')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Requirement status' })).toBeVisible();
  const summary = {
    total: 2,
    verified: 1,
    failed: 0,
    unverified: 1,
    line: "1 of 2 criteria verified. 0 failed. 1 couldn't be verified.",
  };
  f.setVerification({
    result: {
      schemaVersion: '1.0',
      runId: 'verify-run',
      projectId: report.projectId,
      projectName: 'Synthetic books',
      baselineId: report.baselineId,
      url: 'http://localhost:5173/',
      generatedAt: report.generatedAt,
      runtime: { provider: 'codex', auth: 'subscription', model: null, version: 'synthetic' },
      criteria: [],
      summary,
    },
    reportPath: '/synthetic/verification/report.html',
  });
  act(() =>
    f.emit({
      type: 'completed',
      runId: 'verify-run',
      projectId: report.projectId,
      stage: 'complete',
      verification: summary,
    }),
  );
  expect(
    await screen.findByText(/^Browser check finished\. 1 of 2 criteria verified/),
  ).toBeVisible();
  const done = screen.getByRole('region', { name: 'App URL settings' });
  await userEvent.click(await within(done).findByRole('button', { name: 'Open full report' }));
  expect(f.api.openVerificationReport).toHaveBeenCalledWith({
    projectId: report.projectId,
    runId: 'verify-run',
  });
  expect(f.request).not.toHaveBeenCalledWith('report', expect.anything());
  expect(f.request).not.toHaveBeenCalledWith('estimate', expect.anything());
});

test('hosted connections require tool review and history sources are saved only after explicit selection', async () => {
  await openProject();
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
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
  expect(screen.getByLabelText('Name')).toHaveValue('');
  expect(screen.queryByLabelText('Bearer token')).not.toBeInTheDocument();
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
  await userEvent.click(screen.getByRole('checkbox', { name: /list_issues/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save read tools' }));
  await userEvent.click(screen.getByRole('button', { name: 'Overview' }));
  await userEvent.click(screen.getByRole('button', { name: 'Configure history' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Estimation history' }));
  await userEvent.click(dialog.getByRole('checkbox', { name: 'Synthetic MCP' }));
  await userEvent.selectOptions(dialog.getByLabelText('Connection'), 'connection-0');
  await userEvent.selectOptions(dialog.getByLabelText('Read tool'), 'list_issues');
  await userEvent.click(dialog.getByRole('button', { name: 'Discover choices' }));
  expect(dialog.getByText(/Synthetic team/)).toBeVisible();
  await userEvent.type(dialog.getByLabelText('Confirmed source ID'), 'team');
  await userEvent.type(dialog.getByLabelText('Display name'), 'Fixture team');
  await userEvent.click(dialog.getByRole('button', { name: 'Save source' }));
  expect(f.request).toHaveBeenCalledWith(
    'updateSources',
    expect.objectContaining({
      sources: {
        contextConnectionIds: ['connection-0'],
        history: {
          connectionId: 'connection-0',
          historyTool: 'list_issues',
          sourceArgument: 'team',
          sourceId: 'team',
          sourceLabel: 'Fixture team',
        },
      },
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Synthetic MCP' }));
  expect(f.request).toHaveBeenCalledWith('integrationRemove', { connectionId: 'connection-0' });
});

test('pending review survives project loading and draft navigation without automatically starting a run', async () => {
  f.reset(false);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  expect(await screen.findByRole('heading', { name: 'Reviewed baseline' })).toBeVisible();
  await userEvent.click(
    within(screen.getByRole('region', { name: 'Draft chats' })).getByRole('button'),
  );
  expect(screen.getByRole('heading', { name: 'One review is ready.' })).toBeVisible();
  expect(f.request).not.toHaveBeenCalledWith('report', expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'Prepare project' }));
  expect(screen.getByRole('heading', { name: 'Reviewed baseline' })).toBeVisible();
});

test('browser verification started from the CLI never holds the overview as active work', async () => {
  f.addVerificationRun('running');
  await openProject();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(screen.getByRole('button', { name: /Refresh status/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
});

test('saved runs open explicitly and interrupted work resumes only after a user request', async () => {
  f.addInterruptedRun();
  await openProject();
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(f.request).toHaveBeenCalledWith('result', {
    projectId: report.projectId,
    runId: report.id,
  });
  expect(f.request).not.toHaveBeenCalledWith('resume', expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(f.request).toHaveBeenCalledWith('resume', {
    projectId: report.projectId,
    runId: 'interrupted-run',
  });
  expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
});
