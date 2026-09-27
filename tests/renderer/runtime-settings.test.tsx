import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import RuntimeSettings from '../../apps/desktop/src/components/RuntimeSettings';

test('failed model loading presents a recoverable error and preserves custom model selection', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce([{ id: 'known', label: 'Known model', isDefault: true }]);
  render(
    <RuntimeSettings
      runtime={{ provider: 'codex', auth: 'apiKey', model: 'custom' }}
      diagnostics={[]}
      api={{ request } as unknown as DesktopBridge}
      onChange={vi.fn()}
      onRefresh={() => Promise.resolve()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByLabelText('Model')).toHaveValue('custom');
  await userEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  expect(await screen.findByRole('option', { name: 'Known model' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Model')).toHaveValue('custom');
});

test('API key submission clears the password field and reports session-only availability', async () => {
  const request = vi.fn().mockResolvedValue([]);
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <RuntimeSettings
      runtime={{ provider: 'codex', auth: 'apiKey' }}
      diagnostics={[]}
      api={{ request } as unknown as DesktopBridge}
      onChange={vi.fn()}
      onRefresh={refresh}
    />,
  );
  const key = screen.getByLabelText('API key');
  expect(key).toHaveAttribute('type', 'password');
  expect(screen.getByRole('button', { name: 'Use API key' })).toBeDisabled();
  await userEvent.type(key, 'synthetic-test-token');
  await userEvent.click(screen.getByRole('button', { name: 'Use API key' }));
  expect(request).toHaveBeenCalledWith('setKey', {
    provider: 'codex',
    key: 'synthetic-test-token',
  });
  expect(key).toHaveValue('');
  expect(await screen.findByRole('status')).toHaveTextContent('this app session');
  expect(refresh).toHaveBeenCalledOnce();
});

test('switching authentication profiles clears secrets and ignores the previous model response', async () => {
  let resolveOld!: (models: { id: string; label: string }[]) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue([]);
  const props = {
    api: { request } as unknown as DesktopBridge,
    diagnostics: [],
    onChange: vi.fn(),
    onRefresh: () => Promise.resolve(),
  };
  const view = render(
    <RuntimeSettings {...props} runtime={{ provider: 'codex', auth: 'apiKey' }} />,
  );
  await userEvent.type(screen.getByLabelText('API key'), 'synthetic-unsubmitted-secret');
  await userEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  view.rerender(<RuntimeSettings {...props} runtime={{ provider: 'claude', auth: 'apiKey' }} />);
  expect(screen.getByLabelText('API key')).toHaveValue('');
  await act(async () => {
    resolveOld([{ id: 'old-provider-model', label: 'Old provider model' }]);
    await Promise.resolve();
  });
  expect(screen.queryByRole('option', { name: 'Old provider model' })).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('models', {
    runtime: { provider: 'codex', auth: 'apiKey' },
  });
  expect(request).not.toHaveBeenCalledWith('setKey', expect.anything());
});

test('refreshing ready diagnostics discovers models without changing a saved custom selection', async () => {
  const request = vi
    .fn()
    .mockResolvedValue([{ id: 'discovered', label: 'Discovered', isDefault: true }]);
  const props = {
    api: { request } as unknown as DesktopBridge,
    runtime: { provider: 'codex' as const, auth: 'subscription' as const, model: 'saved-custom' },
    onChange: vi.fn(),
    onRefresh: () => Promise.resolve(),
  };
  const view = render(<RuntimeSettings {...props} diagnostics={[]} />);
  expect(request).not.toHaveBeenCalled();
  view.rerender(
    <RuntimeSettings
      {...props}
      diagnostics={[
        {
          provider: 'codex',
          installed: true,
          ready: true,
          subscription: true,
          apiKey: false,
          message: 'Ready',
        },
      ]}
    />,
  );
  expect(await screen.findByRole('option', { name: 'Discovered' })).toBeInTheDocument();
  expect(screen.getByLabelText('Model')).toHaveValue('saved-custom');
  expect(props.onChange).not.toHaveBeenCalled();
});

test('provider changes, explicit model editing, login, and saving use their supplied actions', async () => {
  const request = vi.fn().mockResolvedValue(undefined);
  const onChange = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <RuntimeSettings
      runtime={{ provider: 'codex', auth: 'subscription' }}
      diagnostics={[]}
      api={{ request } as unknown as DesktopBridge}
      onChange={onChange}
      onRefresh={() => Promise.resolve()}
      onSave={onSave}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Claude' }));
  expect(onChange).toHaveBeenCalledWith({ provider: 'claude', auth: 'subscription' });
  await userEvent.selectOptions(screen.getByLabelText('Authentication'), 'apiKey');
  expect(onChange).toHaveBeenCalledWith({ provider: 'codex', auth: 'apiKey' });
  await userEvent.click(screen.getByText('Enter a model ID'));
  await userEvent.type(screen.getByLabelText('Model ID'), 'x');
  expect(onChange).toHaveBeenCalledWith({ provider: 'codex', auth: 'subscription', model: 'x' });
  await userEvent.click(screen.getByRole('button', { name: 'Sign in with Codex' }));
  expect(request).toHaveBeenCalledWith('login', { provider: 'codex' });
  expect(await screen.findByRole('status')).toHaveTextContent('Complete browser sign-in');
  await userEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(await screen.findByRole('status')).toHaveTextContent('Model settings saved');
});

test('a failed credential submission keeps the editable key available for retry', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Credential store unavailable'));
  render(
    <RuntimeSettings
      runtime={{ provider: 'claude', auth: 'apiKey' }}
      diagnostics={[]}
      api={{ request } as unknown as DesktopBridge}
      onChange={vi.fn()}
      onRefresh={() => Promise.resolve()}
    />,
  );
  await userEvent.type(screen.getByLabelText('API key'), 'synthetic-key');
  await userEvent.click(screen.getByRole('button', { name: 'Use API key' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Credential store unavailable');
  expect(screen.getByLabelText('API key')).toHaveValue('synthetic-key');
});
