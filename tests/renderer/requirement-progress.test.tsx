import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import {
  requirementCounts,
  RequirementProgress,
} from '../../apps/desktop/src/components/RequirementProgress';
import type { ItemState } from '../../apps/desktop/src/renderer/requirement-status';

const state = (label: string, tone: ItemState['tone']): ItemState => ({ label, tone, how: '' });

test('progress separates verified requirements from requirements only built in code', () => {
  const states = new Map<string, ItemState>([
    ['REQ-1', state('Done', 'verified')],
    ['REQ-2', { ...state('Done', 'verified'), basis: 'code' }],
    ['REQ-3', state('Built', 'implemented')],
    ['REQ-4', state('In progress', 'partial')],
  ]);
  const counts = requirementCounts(states, 5);
  expect(counts).toEqual({ total: 5, done: 2, built: 1 });
  const { container } = render(<RequirementProgress counts={counts} />);
  expect(screen.getByText('2 of 5 requirements complete')).toBeVisible();
  expect(screen.getByText('· 1 built, not yet verified')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '5');
  expect(container.querySelector<HTMLElement>('.requirement-progress-done')?.style.width).toBe(
    '40%',
  );
  expect(container.querySelector<HTMLElement>('.requirement-progress-built')?.style.width).toBe(
    '20%',
  );
});

test('progress omits the built note when nothing is waiting for verification, and handles no requirements', () => {
  render(<RequirementProgress counts={{ total: 0, done: 0, built: 0 }} />);
  expect(screen.getByText('0 of 0 requirements complete')).toBeVisible();
  expect(screen.queryByText(/not yet verified/)).toBeNull();
});
