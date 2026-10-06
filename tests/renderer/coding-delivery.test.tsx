import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { BetaSchedule } from '../../apps/desktop/src/components/BetaSchedule';
import { CodingDelivery } from '../../apps/desktop/src/components/CodingDelivery';
import { useCodingDelivery } from '../../apps/desktop/src/hooks/useCodingDelivery';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';

function DeliveryHarness({ workspace }: { workspace: Workspace }) {
  const delivery = useCodingDelivery(workspace);
  return <CodingDelivery workspace={workspace} delivery={delivery} />;
}

function fixture() {
  const job = {
    id: 'job',
    status: 'awaiting_merge',
    message: 'Waiting for review',
    model: 'claude-opus-5-5',
    runtime: { model: 'opus', effort: 'high' },
    worktree: '/fixture/job',
    branch: 'aiden/job',
    sessionId: 'session',
    checks: ['Synthetic local check passed'],
    pullRequestUrl: 'https://github.com/fixture/repo/pull/1',
    verificationRunId: 'beta-run',
  };
  const call = vi.fn((method: string, params: any) => {
    if (method === 'state') return Promise.resolve({ runs: [] });
    if (method === 'codingJobs') return Promise.resolve([]);
    if (method === 'startCoding') return Promise.resolve(job);
    if (method === 'betaSettings')
      return Promise.resolve({ enabled: false, intervalMinutes: 60, codingAgentEnabled: true });
    if (method === 'updateBetaSettings') return Promise.resolve(params.settings);
    return Promise.resolve(null);
  });
  const workspace = {
    project: {
      id: 'project',
      repositories: [{ id: 'repo', path: '/fixture/repo' }],
      runtime: { provider: 'claude' },
    },
    call,
    busy: false,
    action: (f: () => Promise<void>) => f(),
    setNotice: vi.fn(),
    setBaseline: vi.fn(),
    setRuns: vi.fn(),
    setVerification: vi.fn(),
    setActivity: vi.fn(),
    setCalls: vi.fn(),
    setConfirmed: vi.fn(),
    setReport: vi.fn(),
    setOpenRun: vi.fn(),
    setArea: vi.fn(),
  } as unknown as Workspace;
  return { workspace, call, job };
}

test('dispatch uses the selected project repository and task, then shows external results separately from beta', async () => {
  const f = fixture();
  render(<DeliveryHarness workspace={f.workspace} />);
  await waitFor(() => expect(f.call).toHaveBeenCalledWith('codingJobs', { projectId: 'project' }));
  fireEvent.click(screen.getByText('Send work to Claude Code'));
  expect(screen.getByRole('button', { name: 'Start Claude Code' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Coding task'), { target: { value: 'Fix the issue' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start Claude Code' }));
  expect(await screen.findByText('Waiting for review')).toBeInTheDocument();
  expect(f.call).toHaveBeenCalledWith('startCoding', {
    projectId: 'project',
    repositoryId: 'repo',
    instruction: 'Fix the issue',
  });
  expect(screen.getByRole('button', { name: 'Start Claude Code' })).toBeDisabled();
  expect(screen.getByText('Local checks reported by Claude Code')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View beta check' }));
  expect(f.workspace.setOpenRun).toHaveBeenCalledWith('beta-run');
  expect(f.call).not.toHaveBeenCalledWith('reconcileDelivery', expect.anything());
});

test('beta schedule loads project settings and saves explicit opt-in, cadence, and revision URL', async () => {
  const f = fixture();
  render(<BetaSchedule workspace={f.workspace} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save beta settings' })).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Enable scheduled beta verification after merge' }),
  );
  fireEvent.change(screen.getByLabelText('Beta verification interval'), {
    target: { value: '1440' },
  });
  fireEvent.change(screen.getByLabelText('Beta revision URL'), {
    target: { value: 'https://beta.example.com/version' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save beta settings' }));
  await waitFor(() =>
    expect(f.call).toHaveBeenCalledWith('updateBetaSettings', {
      projectId: 'project',
      settings: {
        codingAgentEnabled: true,
        enabled: true,
        intervalMinutes: 1440,
        revisionUrl: 'https://beta.example.com/version',
      },
    }),
  );
  expect(f.workspace.setNotice).toHaveBeenCalled();
});

test('default mode has tickets guidance and no coding dispatch control', async () => {
  const f = fixture();
  const original = f.call.getMockImplementation()!;
  f.call.mockImplementation((method, params) =>
    method === 'betaSettings'
      ? Promise.resolve({ enabled: false, intervalMinutes: 60 })
      : original(method, params),
  );
  render(<DeliveryHarness workspace={f.workspace} />);
  await waitFor(() =>
    expect(f.call).toHaveBeenCalledWith('betaSettings', { projectId: 'project' }),
  );
  expect(screen.queryByRole('button', { name: 'Start Claude Code' })).not.toBeInTheDocument();
  expect(screen.getByText(/Aiden writes delivery tickets/)).toBeInTheDocument();
  expect(f.call).not.toHaveBeenCalledWith('startCoding', expect.anything());
});

test('coding beta opt-in saves independently of the verification schedule', async () => {
  const f = fixture();
  const original = f.call.getMockImplementation()!;
  f.call.mockImplementation((method, params) =>
    method === 'betaSettings'
      ? Promise.resolve({ enabled: false, intervalMinutes: 60 })
      : original(method, params),
  );
  render(<BetaSchedule workspace={f.workspace} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save beta settings' })).toBeEnabled(),
  );
  const toggle = screen.getByRole('checkbox', {
    name: 'Enable experimental coding-agent dispatch',
  });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Save beta settings' }));
  await waitFor(() =>
    expect(f.call).toHaveBeenCalledWith('updateBetaSettings', {
      projectId: 'project',
      settings: { enabled: false, intervalMinutes: 60, codingAgentEnabled: true },
    }),
  );
});
