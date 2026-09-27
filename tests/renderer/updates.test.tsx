import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import type { UpdateStatus } from '../../apps/desktop/src/update-types';
import { DesktopUpdateSettings } from '../../apps/desktop/src/views/DesktopUpdateSettings';

const status: UpdateStatus = {
  state: 'idle',
  currentVersion: '1.1.0',
  latestVersion: null,
  progress: null,
  error: null,
  message: null,
  lastCheckedAt: null,
};
function props() {
  const api = {
    checkForUpdates: vi.fn().mockResolvedValue({ ...status, state: 'up-to-date' }),
    downloadUpdate: vi.fn().mockResolvedValue({ ...status, state: 'downloading' }),
    installUpdate: vi.fn().mockResolvedValue({ ...status, state: 'downloaded' }),
  };
  return {
    api: api as unknown as DesktopBridge,
    updateStatus: status,
    updatePreferences: { autoDownload: true, channel: 'stable' as const },
    saveUpdatePreferences: vi.fn(),
    setUpdateStatus: vi.fn(),
    busy: false,
    calls: api,
  };
}
test('update preferences are labelled and require explicit changes', async () => {
  const p = props();
  render(<DesktopUpdateSettings {...p} />);
  await userEvent.click(screen.getByRole('checkbox', { name: /Download updates automatically/ }));
  expect(p.saveUpdatePreferences).toHaveBeenCalledWith({ autoDownload: false, channel: 'stable' });
  await userEvent.click(screen.getByRole('checkbox', { name: /Receive beta updates/ }));
  expect(p.saveUpdatePreferences).toHaveBeenCalledWith({ autoDownload: true, channel: 'beta' });
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(p.calls.checkForUpdates).toHaveBeenCalledOnce();
  expect(p.setUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'up-to-date' }));
});
test('update download, progress, and installation reflect state and active-work restrictions', async () => {
  const p = props();
  const view = render(
    <DesktopUpdateSettings
      {...p}
      updateStatus={{ ...status, state: 'available', latestVersion: '1.2.0' }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Download update' }));
  expect(p.calls.downloadUpdate).toHaveBeenCalledOnce();
  view.rerender(
    <DesktopUpdateSettings
      {...p}
      updateStatus={{
        ...status,
        state: 'downloading',
        progress: { percent: 42.4, transferred: 42, total: 100, bytesPerSecond: 1 },
      }}
    />,
  );
  expect(screen.getByText('Downloading update… 42%')).toBeVisible();
  view.rerender(
    <DesktopUpdateSettings {...p} busy updateStatus={{ ...status, state: 'downloaded' }} />,
  );
  expect(screen.getByRole('button', { name: 'Restart to update' })).toBeDisabled();
  expect(screen.getByText(/Select Restart to update/)).toBeVisible();
  view.rerender(<DesktopUpdateSettings {...p} updateStatus={{ ...status, state: 'downloaded' }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(p.calls.installUpdate).toHaveBeenCalledOnce();
});
test('failed update requests remain recoverable without leaking raw errors', async () => {
  const p = props();
  p.calls.checkForUpdates.mockRejectedValueOnce(new Error('/private/token-secret'));
  const view = render(<DesktopUpdateSettings {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection and try again');
  expect(screen.queryByText(/token-secret/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.rerender(<DesktopUpdateSettings {...p} updateStatus={{ ...status, state: 'disabled' }} />);
  expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
  expect(screen.getByText(/available in the installed desktop app/)).toBeVisible();
});
