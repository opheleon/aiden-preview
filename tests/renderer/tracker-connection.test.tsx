import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { TrackerConnection } from '../../apps/desktop/src/components/TrackerConnection';
import { useIntegrationSignIn } from '../../apps/desktop/src/hooks/useIntegrationSignIn';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';
import type { McpConnection } from '../../packages/contracts/src/index';

const reader = {
  id: 'old',
  name: 'Linear',
  url: 'https://mcp.linear.app/mcp/readonly',
  status: 'disconnected',
} as McpConnection;
const writer = { ...reader, id: 'current', url: 'https://mcp.linear.app/mcp' };
const destination = { provider: 'linear' as const, connectionId: 'current', team: '', project: '' };
function fixture() {
  const call = vi.fn().mockResolvedValue([{ ...writer, status: 'connected' }]);
  const workspace = {
    call,
    integrations: [reader, { ...reader, id: 'older' }, writer],
    action: (fn: () => Promise<void>) => fn(),
    setIntegrations: vi.fn(),
    setSettingsTab: vi.fn(),
    setArea: vi.fn(),
    setError: vi.fn(),
  } as unknown as Workspace;
  return { call, workspace };
}

test('publishing offers the write connection with readiness and reconnects its existing identity', async () => {
  const f = fixture();
  render(
    <TrackerConnection workspace={f.workspace} destination={destination} onChange={vi.fn()} />,
  );
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.getByRole('option', { name: 'Linear · Reconnect required' })).toHaveValue(
    'current',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reconnect Linear' }));
  expect(f.call).toHaveBeenCalledWith('integrationConnect', { connectionId: 'current' });
  expect(f.call.mock.calls.some(([method]) => method === 'integrationAdd')).toBe(false);
  expect(f.workspace.setIntegrations).toHaveBeenCalled();
});

test('new publishing hides experimental connections while an existing selection stays available', () => {
  const f = fixture();
  const custom = {
    ...writer,
    id: 'custom',
    name: 'Custom tracker',
    provider: 'custom' as const,
    url: 'https://example.invalid/mcp',
  };
  const jira = {
    ...custom,
    id: 'jira',
    name: 'Jira',
    url: 'https://mcp.atlassian.com/v2/mcp?tools=all',
  };
  f.workspace.integrations.push(custom, jira);
  const { rerender } = render(
    <TrackerConnection workspace={f.workspace} destination={destination} onChange={vi.fn()} />,
  );
  expect(screen.queryByRole('option', { name: /Experimental/ })).toBeNull();
  rerender(
    <TrackerConnection
      workspace={f.workspace}
      destination={{ ...destination, connectionId: 'custom' }}
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('option', { name: 'Custom tracker · Experimental · Reconnect required' }),
  ).toHaveValue('custom');
  expect(screen.getByRole('button', { name: 'Reconnect Custom tracker' })).toBeEnabled();
  expect(screen.queryByRole('option', { name: /Jira/ })).toBeNull();
});

test('an explicitly saved reader is identified, while an in-progress sign-in does not restart', () => {
  const f = fixture();
  const { rerender } = render(
    <TrackerConnection
      workspace={f.workspace}
      destination={{ ...destination, connectionId: 'old' }}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('read-only');
  expect(screen.getByRole('option', { name: 'Linear · Read-only' })).toBeDisabled();
  rerender(
    <TrackerConnection
      workspace={{
        ...f.workspace,
        integrations: [{ ...writer, status: 'authorization_required' }],
      }}
      destination={destination}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Reconnect Linear' })).toBeDisabled();
  expect(screen.getByText(/Finish signing in in your browser/)).toBeVisible();
});

test('browser OAuth completion refreshes connection state and stops polling once connected', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    const pending = {
      ...f.workspace,
      integrations: [{ ...writer, status: 'authorization_required' as const }],
    };
    const { rerender, unmount } = renderHook(({ workspace }) => useIntegrationSignIn(workspace), {
      initialProps: { workspace: pending },
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(f.workspace.setIntegrations).toHaveBeenCalledWith([{ ...writer, status: 'connected' }]);
    rerender({ workspace: { ...pending, integrations: [] } });
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(f.call).toHaveBeenCalledTimes(1);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});

test('a disconnected publishing connection explains recovery without showing a raw capability error', async () => {
  const f = fixture();
  const { TicketSettings } = await import('../../apps/desktop/src/components/TicketSettings');
  f.call.mockImplementation((method: string) =>
    Promise.resolve(
      method === 'ticketState'
        ? {
            settings: {
              enabled: false,
              destination,
              tools: {
                create: 'save_issue',
                update: 'save_issue',
                get: 'get_issue',
                search: 'list_issues',
              },
              fingerprint: 'a'.repeat(64),
            },
            records: [],
          }
        : [],
    ),
  );
  render(
    <TicketSettings
      workspace={{ ...f.workspace, project: { id: 'p', name: 'Books' } as Workspace['project'] }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Reconnect Linear' })).toBeVisible(),
  );
  expect(f.call.mock.calls.some(([method]) => method === 'ticketCapabilities')).toBe(false);
  expect(screen.getByRole('combobox', { name: 'Linear team' })).toBeDisabled();
});
