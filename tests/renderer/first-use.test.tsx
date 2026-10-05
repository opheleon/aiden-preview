import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import { appFixture } from './app-fixture';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
beforeEach(() => {
  f.reset();
  f.api.getFirstUseState.mockResolvedValue({ completed: false, issue: null });
  f.api.completeFirstUse.mockResolvedValue({ completed: true, issue: null });
});

async function finishSteps() {
  while (screen.queryByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
}

test('first use navigates with readable details and only final confirmation persists completion', async () => {
  render(<App />);
  const heading = await screen.findByRole('heading', { name: 'Meet Aiden' });
  expect(heading).toHaveFocus();
  expect(screen.getByText(/Step 1 of/)).toBeVisible();
  await userEvent.click(screen.getByText('A little more detail'));
  expect(screen.getByText(/Take project management off your plate/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: 'Bring your own subscription' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: 'Meet Aiden' })).toHaveFocus();
  expect(f.api.completeFirstUse).not.toHaveBeenCalled();
  await finishSteps();
  await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.api.completeFirstUse).toHaveBeenCalledTimes(1);
  expect(f.api.openExternal).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalledWith('prepare', expect.anything());
});

test('Later and Escape never confirm and a new launch offers the guide again', async () => {
  const first = render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Later' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(f.api.completeFirstUse).not.toHaveBeenCalled();
  first.unmount();
  render(<App />);
  fireEvent(await screen.findByRole('dialog'), new Event('cancel', { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.api.completeFirstUse).not.toHaveBeenCalled();
});

test('failed confirmation remains visible and a retry succeeds; completed profiles have no automatic guide', async () => {
  f.api.getFirstUseState.mockResolvedValueOnce({ completed: false, issue: 'corrupt' });
  f.api.completeFirstUse.mockRejectedValueOnce(new Error('Could not save confirmation. Retry.'));
  const view = render(<App />);
  await screen.findByText(/saved guide preference could not be read/);
  await finishSteps();
  await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save confirmation');
  expect(screen.getByRole('dialog')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  view.unmount();
  f.api.getFirstUseState.mockResolvedValue({ completed: true, issue: null });
  render(<App />);
  await waitFor(() => expect(document.querySelector('[data-guide-ready="true"]')).toBeTruthy());
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('completed replay exposes bundled docs without resetting completion or changing the project', async () => {
  f.api.getFirstUseState.mockResolvedValue({ completed: true, issue: null });
  render(<App />);
  await waitFor(() => expect(document.querySelector('[data-guide-ready="true"]')).toBeTruthy());
  // The new-project screen discovers models once diagnostics load; count only what the guide does.
  await waitFor(() => expect(f.request).toHaveBeenCalledWith('models', expect.anything()));
  const before = f.request.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Help / Getting started' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Read documentation' }));
  expect(screen.getByRole('heading', { name: 'Documentation' })).toHaveFocus();
  expect(screen.getByRole('article', { name: 'Getting started' })).toHaveTextContent(
    'Linear is optional',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Daily workflow' }));
  expect(screen.getByRole('article', { name: 'Daily workflow' })).toHaveTextContent(
    'does not automatically close',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Troubleshooting' }));
  expect(screen.getByRole('article', { name: 'Troubleshooting' })).toHaveTextContent(
    'preferences/first-use.json',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Back to guide' }));
  expect(screen.getByRole('heading', { name: 'Meet Aiden' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(screen.getByRole('button', { name: 'Help / Getting started' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Help / Getting started' }));
  await finishSteps();
  await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
  expect(f.api.completeFirstUse).not.toHaveBeenCalled();
  expect(f.api.openExternal).not.toHaveBeenCalled();
  expect(
    f.request.mock.calls
      .slice(before)
      .filter(([method]) => !['runs', 'activities', 'activeRuns'].includes(method)),
  ).toEqual([]);
});

test('incomplete replay and unavailable storage remain recoverable without automatic confirmation', async () => {
  f.api.getFirstUseState.mockRejectedValueOnce(new Error('read unavailable'));
  render(<App />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'could not read the guide preference',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Later' }));
  await userEvent.click(screen.getByRole('button', { name: 'Help / Getting started' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(f.api.completeFirstUse).not.toHaveBeenCalled();
  await finishSteps();
  await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.api.completeFirstUse).toHaveBeenCalledTimes(1);
});
