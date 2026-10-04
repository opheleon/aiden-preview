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
  expect(screen.getByText(/You stay in control/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: 'Connect your model' })).toHaveFocus();
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
