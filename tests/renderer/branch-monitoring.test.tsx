import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { appFixture } from './app-fixture';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');

test('project settings discover remote choices on demand and save a project-specific branch before checking', async () => {
  f.reset();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Change branch' }));
  const panel = await screen.findByRole('region', { name: 'Branch monitoring' });
  expect(f.api.request).not.toHaveBeenCalledWith('remoteBranches', expect.anything());
  await userEvent.click(within(panel).getByRole('button', { name: 'Change branch' }));
  const select = await within(panel).findByRole('combobox');
  await within(panel).findByRole('option', { name: 'origin/release' });
  await userEvent.selectOptions(select, JSON.stringify({ remote: 'origin', branch: 'release' }));
  await userEvent.click(within(panel).getByRole('button', { name: 'Save and check branch' }));
  expect(f.api.request).toHaveBeenCalledWith(
    'updateMonitoredBranch',
    expect.objectContaining({
      repositoryId: 'frontend',
      monitoredBranch: { remote: 'origin', branch: 'release' },
    }),
  );
  await screen.findByText(/Monitoring origin\/release/);
  expect(f.api.request).toHaveBeenCalledWith('look', expect.anything());
});
