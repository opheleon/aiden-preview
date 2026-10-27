import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import { BackgroundSettingsCard } from '../../apps/desktop/src/views/BackgroundSettings';

test('opening at login can be turned off in the installed app', async () => {
  const api = {
    getBackgroundSettings: vi.fn().mockResolvedValue({ openAtLogin: true, available: true }),
    setBackgroundSettings: vi.fn().mockResolvedValue({ openAtLogin: false, available: true }),
  };
  render(<BackgroundSettingsCard api={api as unknown as DesktopBridge} />);
  const toggle = await screen.findByRole('checkbox', { name: 'Open Aiden at login' });
  expect(toggle).toBeChecked();
  await userEvent.click(toggle);
  expect(api.setBackgroundSettings).toHaveBeenCalledWith({ openAtLogin: false });
  expect(toggle).not.toBeChecked();
  expect(screen.getByText(/keeps Aiden running in the tray/)).toBeInTheDocument();
});

test('development builds explain that opening at login needs the installed app', async () => {
  const api = {
    getBackgroundSettings: vi.fn().mockResolvedValue({ openAtLogin: true, available: false }),
    setBackgroundSettings: vi.fn(),
  };
  render(<BackgroundSettingsCard api={api as unknown as DesktopBridge} />);
  expect(await screen.findByRole('checkbox', { name: 'Open Aiden at login' })).toBeDisabled();
  expect(screen.getByText(/works only in the installed app/)).toBeInTheDocument();
});

test('a failed change is reported and the setting stays as it was', async () => {
  const api = {
    getBackgroundSettings: vi.fn().mockResolvedValue({ openAtLogin: true, available: true }),
    setBackgroundSettings: vi.fn().mockRejectedValue(new Error('denied')),
  };
  render(<BackgroundSettingsCard api={api as unknown as DesktopBridge} />);
  const toggle = await screen.findByRole('checkbox', { name: 'Open Aiden at login' });
  await userEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not change this setting');
  expect(toggle).toBeChecked();
});
