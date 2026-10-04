import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DeliveryTicket } from '../../apps/desktop/src/components/DeliveryTicket';
import { TicketSettings } from '../../apps/desktop/src/components/TicketSettings';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';
import type { TicketSettings as Settings } from '../../packages/contracts/src/tickets';

const tools = {
  create: 'save_issue',
  update: 'save_issue',
  get: 'get_issue',
  search: 'list_issues',
};
const settings: Settings = {
  enabled: true,
  destination: { provider: 'linear', connectionId: 'linear', team: 'Books', project: 'Library' },
  tools,
  fingerprint: 'a'.repeat(64),
};
function fixture(saved: Settings | null, offline = false) {
  const call = vi.fn((method: string) => {
    if (method === 'linearTeams') return Promise.resolve([{ id: 'team-books', name: 'Books' }]);
    if (method === 'ticketState') return Promise.resolve({ settings: saved, records: [] });
    if (method === 'ticketCapabilities')
      return offline
        ? Promise.reject(new Error('Tracker offline'))
        : Promise.resolve({ tools, fingerprint: settings.fingerprint });
    return Promise.resolve({ settings, records: [] });
  });
  const workspace = {
    call,
    project: { id: 'p', name: 'Deliver books' },
    integrations: [
      { id: 'linear', name: 'Linear', status: 'connected', url: 'https://mcp.linear.app/mcp' },
    ],
    action: (fn: () => Promise<void>) => fn(),
    setNotice: vi.fn(),
    busy: false,
  } as unknown as Workspace;
  return { call, workspace };
}
test('one project setting grants automatic tickets in the selected destination', async () => {
  const f = fixture(null);
  render(<TicketSettings workspace={f.workspace} />);
  expect(screen.queryByRole('option', { name: /Jira/ })).toBeNull();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'MCP connection' }), 'linear');
  expect(f.call.mock.calls.some(([method]) => method === 'linearTeams')).toBe(false);
  await userEvent.click(screen.getByRole('combobox', { name: 'Linear team' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Books' }));
  expect(screen.getByText('New Linear project: Deliver books')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: /Linear project/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /Automatically create/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create project and publish tickets' }),
    ).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Create project and publish tickets' }));
  expect(f.call).toHaveBeenLastCalledWith('publishLinearTickets', {
    projectId: 'p',
    connectionId: 'linear',
    teamId: 'team-books',
    tools,
    fingerprint: settings.fingerprint,
  });
});

test('saved Jira settings remain labeled experimental and can pause publishing while offline', async () => {
  const jira: Settings = {
    ...settings,
    destination: {
      provider: 'jira',
      connectionId: 'jira',
      cloudId: 'site',
      projectKey: 'BOOK',
      issueTypeName: 'Task',
    },
  };
  const f = fixture(jira, true);
  f.workspace.integrations = [
    {
      id: 'jira',
      name: 'Jira',
      provider: 'custom',
      url: 'https://mcp.atlassian.com/v2/mcp?tools=all',
      status: 'connected',
    } as Workspace['integrations'][number],
  ];
  render(<TicketSettings workspace={f.workspace} />);
  await screen.findByText('Tracker offline');
  expect(screen.getByRole('option', { name: 'Jira · Experimental' })).toBeInTheDocument();
  expect(screen.getByText(/Live end-to-end testing is incomplete/)).toBeVisible();
  expect(screen.getByLabelText('Jira project key')).toHaveValue('BOOK');
  await userEvent.click(screen.getByRole('checkbox', { name: /Automatically create/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
  expect(f.call).toHaveBeenLastCalledWith('saveTicketSettings', {
    projectId: 'p',
    settings: { ...jira, enabled: false },
  });
});
test('automatic publishing can be paused even when the tracker cannot be reached', async () => {
  const f = fixture(settings, true);
  render(<TicketSettings workspace={f.workspace} />);
  await screen.findByText('Tracker offline');
  await userEvent.click(screen.getByRole('checkbox', { name: /Automatically create/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
  expect(f.call).toHaveBeenLastCalledWith('saveTicketSettings', {
    projectId: 'p',
    settings: { ...settings, enabled: false },
  });
});
test('ticket content checks and tracker Done remain distinct from acceptance verification', () => {
  render(
    <DeliveryTicket
      ticket={{ id: 'F-1', title: 'Books', blocked: false, markdown: 'Acceptance criteria' }}
      remote={{
        featureId: 'F-1',
        title: 'Books',
        marker: 'fixture',
        state: 'synced',
        issueId: 'BOOK-1',
        url: 'https://linear.app/fixture',
        remoteStatus: 'Done',
        assignee: 'Alex',
        message:
          'Ticket content read back and verified. Tracker status is not acceptance evidence.',
      }}
    />,
  );
  expect(screen.getByText(/Tracker: Done/)).toBeInTheDocument();
  expect(screen.getByText(/not acceptance evidence/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'BOOK-1', hidden: true })).toHaveAttribute(
    'href',
    'https://linear.app/fixture',
  );
});
