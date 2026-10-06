import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import { SidebarUpdate } from '../../apps/desktop/src/components/SidebarUpdate';
import type { UpdateStatus } from '../../apps/desktop/src/update-types';

const status: UpdateStatus = {
  state: 'idle',
  currentVersion: '1.2.1',
  latestVersion: null,
  progress: null,
  error: null,
  message: null,
  lastCheckedAt: null,
};
function fixture() {
  const calls = {
    checkForUpdates: vi.fn().mockResolvedValue({ ...status, state: 'up-to-date' }),
    downloadUpdate: vi.fn().mockResolvedValue({ ...status, state: 'downloaded' }),
    installUpdate: vi.fn().mockResolvedValue({ ...status, state: 'downloaded' }),
  };
  return {
    api: calls as unknown as DesktopBridge,
    calls,
    updateStatus: status,
    setUpdateStatus: vi.fn(),
    busy: false,
  };
}

test('the sidebar checks directly and prevents duplicate requests while checking', async () => {
  const p = fixture();
  let finish!: (value: UpdateStatus) => void;
  p.calls.checkForUpdates.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const view = render(<SidebarUpdate {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.getByRole('button', { name: 'Checking for updates…' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Checking for updates…' }));
  expect(p.calls.checkForUpdates).toHaveBeenCalledOnce();
  await act(() => {
    finish({ ...status, state: 'up-to-date' });
    return Promise.resolve();
  });
  expect(p.setUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'up-to-date' }));
  view.rerender(<SidebarUpdate {...p} updateStatus={{ ...status, state: 'up-to-date' }} />);
  expect(screen.getByText('You’re up to date')).toBeVisible();
  view.rerender(<SidebarUpdate {...p} updateStatus={{ ...status, state: 'checking' }} />);
  expect(screen.getByRole('button', { name: 'Checking for updates…' })).toBeDisabled();
});

test('offered updates download directly and expose accessible progress', async () => {
  const p = fixture();
  const offered: UpdateStatus = { ...status, state: 'available', latestVersion: '1.2.2' };
  const view = render(<SidebarUpdate {...p} updateStatus={offered} />);
  expect(screen.getByText('Version 1.2.2')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Download update' }));
  expect(p.calls.downloadUpdate).toHaveBeenCalledOnce();
  expect(p.calls.installUpdate).not.toHaveBeenCalled();
  view.rerender(
    <SidebarUpdate
      {...p}
      updateStatus={{
        ...offered,
        state: 'downloading',
        progress: { percent: 42.4, transferred: 42, total: 100, bytesPerSecond: 1 },
      }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Downloading… 42%' })).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
    'value',
    '42',
  );
});

test('restart is explicit, blocked during work, and shows trusted updater refusal messages', async () => {
  const p = fixture();
  const ready: UpdateStatus = { ...status, state: 'downloaded', latestVersion: '1.2.2' };
  const view = render(<SidebarUpdate {...p} busy updateStatus={ready} />);
  expect(screen.getByRole('button', { name: 'Restart to update' })).toBeDisabled();
  expect(screen.getByText('Finish the current run to restart.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(p.calls.installUpdate).not.toHaveBeenCalled();
  view.rerender(<SidebarUpdate {...p} updateStatus={ready} />);
  await userEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(p.calls.installUpdate).toHaveBeenCalledOnce();
  view.rerender(
    <SidebarUpdate
      {...p}
      updateStatus={{
        ...ready,
        message: 'Finish or cancel the active assessment before restarting to update.',
      }}
    />,
  );
  expect(screen.getByText(/Finish or cancel the active assessment/)).toBeVisible();
});

test('errors retry the appropriate update operation without displaying raw IPC failures', async () => {
  const p = fixture();
  p.calls.checkForUpdates.mockRejectedValueOnce(new Error('/private/token-secret'));
  const view = render(<SidebarUpdate {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update Aiden');
  expect(screen.queryByText(/token-secret/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.rerender(<SidebarUpdate {...p} updateStatus={{ ...status, state: 'error' }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Retry update' }));
  expect(p.calls.checkForUpdates).toHaveBeenCalledTimes(3);
  view.rerender(
    <SidebarUpdate {...p} updateStatus={{ ...status, state: 'error', latestVersion: '1.2.2' }} />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The update failed. Try again.');
  await userEvent.click(screen.getByRole('button', { name: 'Retry update' }));
  expect(p.calls.downloadUpdate).toHaveBeenCalledOnce();
});

test('unsupported development builds and an unavailable bridge do not offer update actions', () => {
  const p = fixture();
  const view = render(<SidebarUpdate {...p} updateStatus={undefined} />);
  expect(screen.queryByRole('region', { name: 'App update' })).not.toBeInTheDocument();
  view.rerender(<SidebarUpdate {...p} updateStatus={{ ...status, state: 'disabled' }} />);
  expect(screen.queryByRole('region', { name: 'App update' })).not.toBeInTheDocument();
  view.rerender(<SidebarUpdate {...p} api={undefined} />);
  expect(screen.queryByRole('region', { name: 'App update' })).not.toBeInTheDocument();
});
