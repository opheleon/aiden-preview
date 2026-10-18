import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import * as features from '../../apps/desktop/src/renderer/verification-features';
import { DeviceTesting } from '../../apps/desktop/src/views/DeviceTesting';

beforeEach(() => vi.spyOn(features, 'phoneVerificationVisible').mockReturnValue(true));
afterEach(() => vi.restoreAllMocks());

const project = {
  id: 'project-1',
  name: 'Notes',
  context: 'Save notes',
  repositories: [],
  runtime: { provider: 'codex' as const, auth: 'subscription' as const },
};

test('a project assessment can be followed by an installed-app check and consent resets when its target changes', async () => {
  const request = vi.fn().mockImplementation((method: string) => {
    if (method === 'phoneSetup') return Promise.resolve({ settings: {}, phones: [], checks: [] });
    if (method === 'phoneApps') return Promise.resolve([]);
    if (method === 'verificationSettings') return Promise.resolve({ url: null });
    if (method === 'updateVerificationSettings') return Promise.resolve({ url: null });
    if (method === 'deviceRuns') return Promise.resolve([]);
    if (method === 'deviceProbe')
      return Promise.resolve({ deviceName: 'Test iPhone', platformVersion: '18' });
    return Promise.resolve({ runId: 'fixture-run' });
  });
  render(
    <DeviceTesting api={{ request } as unknown as DesktopBridge} project={project} busy={false} />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('iPhone app (installed TestFlight build)')).toBeEnabled(),
  );
  await userEvent.click(screen.getByLabelText('iPhone app (installed TestFlight build)'));
  await userEvent.click(screen.getByText('Advanced phone settings'));
  await userEvent.selectOptions(screen.getByLabelText('Phone connection'), 'manual');
  await userEvent.type(screen.getByLabelText('iPhone device ID'), '00008110-0011223344556677');
  await userEvent.type(screen.getByLabelText('App identifier'), 'com.example.notes');
  await userEvent.type(screen.getByLabelText('TestFlight version / build'), '1 (42)');
  await userEvent.click(screen.getByText('Check phone connection'));
  await screen.findByText(/Connected to Test iPhone/);
  const start = screen.getByRole('button', { name: 'Run verification now' });
  await userEvent.click(start);
  expect(await screen.findByRole('alert')).toHaveTextContent(/Allow interaction/);
  const consent = screen.getByRole('checkbox', { name: /Allow taps/ });
  await userEvent.click(consent);
  await userEvent.type(screen.getByLabelText('App identifier'), '.beta');
  expect(consent).not.toBeChecked();
  await userEvent.click(consent);
  await userEvent.click(start);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      'look',
      expect.objectContaining({
        projectId: project.id,
        verifySurfaces: true,
      }),
    ),
  );
  expect(
    request.mock.calls.some(([method]) =>
      ['prepare', 'report', 'discoverRepositories'].includes(method as string),
    ),
  ).toBe(false);
});

test('device history exposes stop and evidence actions, and connection errors remain visible', async () => {
  const run = {
    id: 'run',
    source: {
      projectId: project.id,
      reportId: 'code-report',
      baselineId: 'baseline-1',
      checks: [{ requirementId: 'REQ-1', codeStatus: 'partial' }],
    },
    name: 'Notes',
    buildLabel: '42',
    status: 'running',
    message: 'Checking the note',
    criteria: [{ criterion: 'Save a note', verdict: 'unverified', explanation: 'Still loading' }],
  };
  const request = vi
    .fn()
    .mockImplementation((method: string) =>
      Promise.resolve(
        method === 'deviceRuns'
          ? [run]
          : method === 'verificationSettings'
            ? { url: null }
            : { cancelled: true },
      ),
    );
  const openDeviceReport = vi.fn().mockRejectedValue(new Error('Could not open evidence'));
  render(
    <DeviceTesting
      api={{ request, openDeviceReport } as unknown as DesktopBridge}
      project={project}
      busy={false}
    />,
  );
  await screen.findByText('Checking the note');
  expect(screen.getByLabelText('iPhone app (installed TestFlight build)')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Stop test' }));
  expect(request).toHaveBeenCalledWith('deviceCancel', { runId: 'run' });
  await userEvent.click(screen.getByRole('button', { name: 'Open evidence report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not open evidence');
});

test('phone and installed-app pickers detect the build, use managed mode and share signing preferences', async () => {
  const udid = '00008110-0011223344556677';
  const request = vi.fn().mockImplementation((method: string, params: unknown) => {
    if (method === 'verificationSettings') return Promise.resolve({ url: null });
    if (method === 'phoneSetup')
      return Promise.resolve({
        settings: {},
        checks: [{ name: 'Xcode', ready: true, message: 'Found Apple tools' }],
        phones: [{ udid, name: 'Fixture phone', version: '18', state: 'Paired' }],
      });
    if (method === 'phoneApps')
      return Promise.resolve([
        { bundleId: 'com.example.notes', name: 'Notes', version: '1.2', build: '42' },
      ]);
    if (method === 'deviceRuns') return Promise.resolve([]);
    if (method === 'updateVerificationSettings' || method === 'savePhoneSetup')
      return Promise.resolve(params);
    return Promise.resolve({});
  });
  render(
    <DeviceTesting api={{ request } as unknown as DesktopBridge} project={project} busy={false} />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('iPhone app (installed TestFlight build)')).toBeEnabled(),
  );
  await userEvent.click(screen.getByLabelText('iPhone app (installed TestFlight build)'));
  await screen.findByRole('option', { name: /Fixture phone/ });
  await userEvent.selectOptions(screen.getByLabelText('iPhone', { exact: true }), udid);
  await screen.findByRole('option', { name: /Notes ·/ });
  await userEvent.selectOptions(screen.getByLabelText('Installed app'), 'com.example.notes');
  await screen.findByText('Build: 1.2 (42)');
  await userEvent.click(screen.getByRole('checkbox', { name: /Allow taps/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save verification settings' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      'updateVerificationSettings',
      expect.objectContaining({
        phone: expect.objectContaining({
          buildLabel: '1.2 (42)',
          target: expect.objectContaining({
            connection: 'managed',
            udid,
            bundleId: 'com.example.notes',
            deviceName: 'Fixture phone',
            appName: 'Notes',
          }),
        }),
      }),
    ),
  );
  await userEvent.click(screen.getByText('Connect your iPhone: shared setup'));
  await userEvent.click(screen.getByText('Apple signing'));
  await userEvent.type(screen.getByLabelText('Apple development team ID'), 'ABCDE12345');
  await userEvent.click(screen.getByRole('button', { name: 'Save shared connection setup' }));
  expect(request).toHaveBeenCalledWith('savePhoneSetup', { teamId: 'ABCDE12345' });
});
