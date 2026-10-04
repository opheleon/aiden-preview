import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { LinearTeamPicker } from '../../apps/desktop/src/components/LinearTeamPicker';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';

function fixture() {
  const call = vi.fn().mockResolvedValue([
    { id: 'team-books', name: 'Books' },
    { id: 'team-web', name: 'Web' },
  ]);
  return { call, workspace: { call } as unknown as Workspace };
}

test('team dropdown loads on open, supports keyboard selection, and does not invent a default', async () => {
  const f = fixture();
  const change = vi.fn();
  render(
    <LinearTeamPicker workspace={f.workspace} connectionId="linear" value="" onChange={change} />,
  );
  expect(f.call).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('combobox', { name: 'Linear team' }));
  expect(f.call).toHaveBeenCalledWith('linearTeams', { connectionId: 'linear' });
  expect(change).not.toHaveBeenCalled();
  await userEvent.tab();
  expect(screen.getByRole('option', { name: 'Books' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(change).toHaveBeenCalledWith('team-web');
  expect(screen.getByRole('combobox')).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.keyboard('{Escape}');
  expect(f.call).toHaveBeenCalledTimes(1);
});

test('empty teams and failed reads have actionable states and can be retried', async () => {
  const f = fixture();
  f.call
    .mockRejectedValueOnce(new Error('Reconnect Linear to load teams'))
    .mockResolvedValueOnce([]);
  render(
    <LinearTeamPicker workspace={f.workspace} connectionId="linear" value="" onChange={vi.fn()} />,
  );
  await userEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect Linear');
  await userEvent.click(screen.getByRole('button', { name: 'Retry teams' }));
  expect(await screen.findByText(/No teams are available/)).toBeVisible();
});

test('switching connections ignores a late team response from the previous account', async () => {
  const f = fixture();
  let resolve!: (teams: { id: string; name: string }[]) => void;
  const old = new Promise<{ id: string; name: string }[]>((r) => {
    resolve = r;
  });
  f.call.mockReturnValueOnce(old);
  const { rerender } = render(
    <LinearTeamPicker
      key="old"
      workspace={f.workspace}
      connectionId="old"
      value=""
      onChange={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  rerender(
    <LinearTeamPicker
      key="new"
      workspace={f.workspace}
      connectionId="new"
      value=""
      onChange={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('combobox'));
  await screen.findByRole('option', { name: 'Books' });
  await act(async () => {
    resolve([{ id: 'stale', name: 'Wrong account' }]);
    await old;
  });
  expect(screen.queryByRole('option', { name: 'Wrong account' })).not.toBeInTheDocument();
});
