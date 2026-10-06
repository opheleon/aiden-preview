import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { appFixture } from './app-fixture';

const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
const workerRequest = f.request.getMockImplementation()!;
beforeEach(() => f.reset());
afterEach(() => f.request.mockImplementation(workerRequest));

/** The top header bar; an open project's brief renders its own header too, so match by class. */
function header(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('header.app-header');
  if (!bar) throw new Error('The application header did not render.');
  return bar;
}

/** Assert "Projects" appears in the header once, as the navigation button, and "Settings" never as text. */
function expectNoAreaLabel(): void {
  const bar = within(header());
  expect(bar.getAllByText('Projects')).toEqual([bar.getByRole('button', { name: 'Projects' })]);
  expect(bar.queryByText('Settings')).toBeNull();
}

test('a fresh install with no projects shows no Projects label in the header', async () => {
  f.request.mockImplementation((method: string, params?: unknown) =>
    method === 'projects' ? Promise.resolve([]) : workerRequest(method, params),
  );
  render(<App />);
  expect(await screen.findByRole('heading', { name: /What are you building/ })).toBeVisible();
  expectNoAreaLabel();
});

test('opening a project keeps the header label away, and header navigation still switches areas', async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await screen.findByRole('region', { name: 'Requirements' });
  expectNoAreaLabel();

  await userEvent.click(within(header()).getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: /Application settings/ })).toBeVisible();
  expectNoAreaLabel();

  await userEvent.click(within(header()).getByRole('button', { name: 'Projects' }));
  expect(await screen.findByRole('region', { name: 'Requirements' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: /Application settings/ })).toBeNull();
  expectNoAreaLabel();
});
