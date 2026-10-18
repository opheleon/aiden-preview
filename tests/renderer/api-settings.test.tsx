import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import { ProjectVerificationSettings } from '../../apps/desktop/src/components/ProjectVerificationSettings';

test('project settings preserve surfaces together, reset API write consent on target change, and persist automatic mode', async () => {
  const request = vi.fn().mockImplementation((method, params) =>
    Promise.resolve(
      method === 'verificationSettings'
        ? {
            url: 'http://localhost:3000/',
            api: { url: 'http://localhost:8000/', allowMutations: true },
          }
        : params,
    ),
  );
  render(
    <ProjectVerificationSettings projectId="p" api={{ request } as unknown as DesktopBridge} />,
  );
  const input = await screen.findByRole('textbox', { name: 'API base URL' });
  const writes = screen.getByRole('checkbox', { name: /Allow writes/ });
  await waitFor(() => expect(input).toHaveValue('http://localhost:8000/'));
  expect(writes).toBeChecked();
  await userEvent.clear(input);
  await userEvent.type(input, 'http://localhost:8001/');
  expect(writes).not.toBeChecked();
  await userEvent.selectOptions(screen.getByLabelText('When to verify'), 'after_assessment');
  await userEvent.click(screen.getByRole('button', { name: 'Save verification settings' }));
  expect(request).toHaveBeenLastCalledWith('updateVerificationSettings', {
    projectId: 'p',
    url: 'http://localhost:3000/',
    webLogin: null,
    trigger: 'after_assessment',
    rememberCredentials: true,
    api: { url: 'http://localhost:8001/', allowMutations: false, keyHeader: 'X-API-Key' },
  });
  expect(request.mock.calls.some(([method]) => method === 'look')).toBe(false);
  await userEvent.click(screen.getByRole('checkbox', { name: 'API' }));
  await userEvent.click(screen.getByRole('button', { name: 'Run verification now' }));
  expect(request).toHaveBeenCalledWith(
    'updateVerificationSettings',
    expect.objectContaining({ api: null }),
  );
  expect(request).toHaveBeenLastCalledWith('look', { projectId: 'p', verifySurfaces: true });
});

test('configuration load failures block saving and starting a check', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Unavailable'));
  render(
    <ProjectVerificationSettings projectId="p" api={{ request } as unknown as DesktopBridge} />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
  expect(screen.getByRole('button', { name: 'Save verification settings' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Run verification now' })).toBeDisabled();
});

test('session fallback is visible and a user can choose memory-only credentials', async () => {
  const settings = {
    url: null,
    api: { url: 'http://localhost:8000/', allowMutations: false, keyHeader: 'X-API-Key' },
    credentialStorage: 'session',
    rememberCredentials: true,
  };
  const request = vi
    .fn()
    .mockImplementation((method, params) =>
      Promise.resolve(method === 'verificationSettings' ? settings : { ...settings, ...params }),
    );
  render(
    <ProjectVerificationSettings projectId="p" api={{ request } as unknown as DesktopBridge} />,
  );
  expect(await screen.findByText(/Secure storage was unavailable/)).toBeVisible();
  const remember = screen.getByLabelText('Remember test credentials on this device');
  expect(remember).toBeChecked();
  await userEvent.click(remember);
  expect(screen.getByText(/Credentials stay in memory until Aiden closes/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Save verification settings' }));
  expect(request).toHaveBeenLastCalledWith(
    'updateVerificationSettings',
    expect.objectContaining({ rememberCredentials: false }),
  );
});
