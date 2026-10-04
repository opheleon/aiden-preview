import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import { ApiVerificationSettings } from '../../apps/desktop/src/components/ApiVerificationSettings';

test('API writes require explicit opt-in and reset when the target changes; clearing removes the configuration', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ url: null, api: { url: 'http://localhost:8000/', allowMutations: true } });
  render(<ApiVerificationSettings projectId="p" api={{ request } as unknown as DesktopBridge} />);
  const input = screen.getByRole('textbox', { name: 'API base URL' });
  const writes = screen.getByRole('checkbox', { name: /Allow writes/ });
  await waitFor(() => expect(input).toHaveValue('http://localhost:8000/'));
  expect(writes).toBeChecked();
  await userEvent.clear(input);
  await userEvent.type(input, 'http://localhost:8001/');
  expect(writes).not.toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Save API settings' }));
  expect(request).toHaveBeenLastCalledWith('updateVerificationSettings', {
    projectId: 'p',
    api: { url: 'http://localhost:8001/', allowMutations: false },
  });
  await userEvent.click(writes);
  await userEvent.click(screen.getByRole('button', { name: 'Save API settings' }));
  expect(request).toHaveBeenLastCalledWith('updateVerificationSettings', {
    projectId: 'p',
    api: { url: 'http://localhost:8001/', allowMutations: true },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Clear API target' }));
  expect(request).toHaveBeenLastCalledWith('updateVerificationSettings', {
    projectId: 'p',
    api: null,
  });
  expect(input).toHaveValue('');
  expect(writes).not.toBeChecked();
});
