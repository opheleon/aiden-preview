import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { appFixture } from './app-fixture';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');

test('project settings discover remote choices on demand and save a project-specific branch, then check every branch at once', async () => {
  f.reset();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  expect(screen.queryByRole('button', { name: 'Change branch' })).toBeNull();
  await userEvent.click(screen.getByLabelText('Actions for Synthetic books'));
  expect(screen.queryByRole('menuitem', { name: /Change branch/ })).toBeNull();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }));
  const settings = await screen.findByRole('region', { name: 'Testing settings' });
  const panel = within(settings).getByRole('region', { name: 'Branch monitoring' });
  expect(within(settings).getByRole('region', { name: 'Project verification' })).toBeVisible();
  expect(f.api.request).not.toHaveBeenCalledWith('remoteBranches', expect.anything());
  await userEvent.click(within(panel).getByRole('button', { name: 'Change branch' }));
  const select = await within(panel).findByRole('combobox');
  await within(panel).findByRole('option', { name: 'origin/release' });
  await userEvent.selectOptions(select, JSON.stringify({ remote: 'origin', branch: 'release' }));
  await userEvent.click(within(panel).getByRole('button', { name: 'Save branch' }));
  expect(f.api.request).toHaveBeenCalledWith(
    'updateMonitoredBranch',
    expect.objectContaining({
      repositoryId: 'frontend',
      monitoredBranch: { remote: 'origin', branch: 'release' },
    }),
  );
  await userEvent.click(await screen.findByLabelText('Actions for Synthetic books'));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }));
  expect(await screen.findByText('origin/release')).toBeVisible();
  expect(f.api.request).not.toHaveBeenCalledWith('look', expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'Check these branches' }));
  expect(f.api.request).toHaveBeenCalledWith('look', expect.anything());
});
