import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import RequirementEstimates from '../../apps/desktop/src/components/RequirementEstimates';
import { defaultOverrides } from '../../packages/estimation/src/index';
import { estimateFixture, report } from './fixtures';

function props() {
  const estimation = estimateFixture();
  return {
    estimation,
    report,
    overrides: defaultOverrides(),
    busy: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onReestimate: vi.fn().mockResolvedValue(undefined),
    onConfigureHistory: vi.fn(),
    onOpenExternal: vi.fn(),
  };
}
test('estimates size remaining work separately from requirement status', async () => {
  const p = props();
  render(<RequirementEstimates {...p} />);
  expect(screen.getByRole('heading', { name: 'Remaining work estimates' })).toBeVisible();
  expect(screen.queryByText('Code evidence')).toBeNull();
  expect(screen.queryByText('Deviated')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Re-estimate' }));
  expect(p.onReestimate).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Configure history' }));
  expect(p.onConfigureHistory).toHaveBeenCalledOnce();
});
test('size override failures keep the editor open, and a retry saves the explicit value', async () => {
  const p = props();
  p.onSave.mockRejectedValueOnce(new Error('Write interrupted'));
  render(<RequirementEstimates {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit complexity REQ-1' }));
  await userEvent.click(
    within(screen.getByRole('dialog', { name: 'Complexity' })).getByRole('button', {
      name: 'M',
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Write interrupted');
  expect(screen.getByRole('dialog', { name: 'Complexity' })).toBeVisible();
  await userEvent.click(
    within(screen.getByRole('dialog', { name: 'Complexity' })).getByRole('button', {
      name: 'M',
    }),
  );
  expect(p.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ remainingPoints: { 'REQ-1': 3 } }),
  );
  expect(screen.queryByRole('dialog', { name: 'Complexity' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('no history means no time input, and saved manual durations cannot masquerade as predictions', async () => {
  const p = props();
  Object.assign(p.estimation.requirements[0]!, { durationDays: 1, durationOverridden: true });
  p.overrides.durations = { 'REQ-1': 1 };
  render(<RequirementEstimates {...p} />);
  expect(screen.getByRole('button', { name: 'Explain duration REQ-1' })).toHaveTextContent(
    'Unavailable',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Explain duration REQ-1' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByRole('spinbutton')).not.toBeInTheDocument();
  await userEvent.click(dialog.getByRole('button', { name: 'Configure history' }));
  expect(p.onConfigureHistory).toHaveBeenCalledOnce();
  expect(p.onSave).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('remaining size reset preserves other saved overrides', async () => {
  const p = props();
  Object.assign(p.estimation.requirements[0]!, {
    remainingPoints: 5,
    remainingPointsOverridden: true,
  });
  p.overrides.remainingPoints = { 'REQ-1': 5 };
  render(<RequirementEstimates {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit complexity REQ-1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reset size to suggested' }));
  expect(p.onSave).toHaveBeenCalledWith({ ...p.overrides, remainingPoints: {} });
});

test('historical duration explains matches, dates, range, median, and insufficient samples', async () => {
  const p = props();
  p.estimation.historyTruncated = true;
  p.estimation.historyCollectedAt = '2026-09-26T00:00:00.000Z';
  p.estimation.history = [1, 3, 5].map((days, index) => ({
    connectionId: 'fixture',
    sourceId: 'team',
    id: `issue-${index}`,
    identifier: `TEAM-${index}`,
    title: 'Synthetic work',
    description: '',
    ...(index === 0 ? { url: 'https://example.invalid/1' } : {}),
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: `2026-09-0${days + 1}T00:00:00.000Z`,
    observedCalendarDays: days,
    size: 'S',
    points: 2,
    workType: 'integration',
    scopeShape: 'bounded_change',
  }));
  const row = p.estimation.requirements[0]!;
  row.comparisons = p.estimation.history.map((issue) => issue.id);
  row.remaining!.comparisonMatches = row.comparisons.map((id) => ({
    id,
    reasoning: `Shared integration testing boundary: ${id}`,
  }));
  const { rerender } = render(<RequirementEstimates {...p} />);
  expect(screen.getByRole('button', { name: 'Explain duration REQ-1' })).toHaveTextContent(
    '1–5 days',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Explain duration REQ-1' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Median: 3 days/)).toBeVisible();
  expect(dialog.getByText('Shared integration testing boundary: issue-0')).toBeVisible();
  expect(dialog.getByText(/1 day · 2026-09-01 to 2026-09-02/)).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: 'TEAM-0 · Synthetic work' }));
  expect(p.onOpenExternal).toHaveBeenCalledWith('https://example.invalid/1');
  expect(dialog.queryByRole('button', { name: 'TEAM-1 · Synthetic work' })).not.toBeInTheDocument();
  p.estimation.history = p.estimation.history.slice(0, 2);
  rerender(<RequirementEstimates {...p} />);
  expect(dialog.getByText(/Only 2 eligible comparisons/)).toBeVisible();
  expect(dialog.queryByText(/Median:/)).not.toBeInTheDocument();
  await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
  expect(p.onSave).not.toHaveBeenCalled();
});

test('historical calibration links, adjustments, resets, and cancellation stay local to the project', async () => {
  const p = props();
  p.estimation.history = [
    {
      connectionId: 'fixture',
      sourceId: 'team',
      id: 'issue',
      identifier: 'TEAM-1',
      title: 'List books',
      description: 'Synthetic history',
      url: 'https://example.invalid/TEAM-1',
      startedAt: '2026-09-01T00:00:00.000Z',
      completedAt: '2026-09-04T00:00:00.000Z',
      observedCalendarDays: 3,
      size: 'S',
      points: 2,
      workType: 'integration',
      scopeShape: 'bounded_change',
    },
  ];
  p.overrides.historicalPoints.issue = 3;
  render(<RequirementEstimates {...p} />);
  await userEvent.click(screen.getByText('Team history · 1 completed issues'));
  await userEvent.click(screen.getByRole('button', { name: 'TEAM-1' }));
  expect(p.onOpenExternal).toHaveBeenCalledWith('https://example.invalid/TEAM-1');
  await userEvent.click(screen.getByRole('button', { name: 'Edit comparison TEAM-1' }));
  await userEvent.click(
    within(screen.getByRole('dialog', { name: 'Historical comparison' })).getByRole('button', {
      name: 'L',
    }),
  );
  expect(p.onSave).toHaveBeenLastCalledWith({ ...p.overrides, historicalPoints: { issue: 5 } });
  await userEvent.click(screen.getByRole('button', { name: 'Edit comparison TEAM-1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reset comparison' }));
  expect(p.onSave).toHaveBeenLastCalledWith({ ...p.overrides, historicalPoints: {} });
  await userEvent.click(screen.getByRole('button', { name: 'Edit comparison TEAM-1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(p.onSave).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('complete and unknown requirements do not offer editable remaining sizes or invented time', async () => {
  const p = props();
  p.estimation.requirements[0]!.remainingPoints = 0;
  p.estimation.requirements[1]!.remainingPoints = null;
  p.estimation.requirements[1]!.remaining = null;
  render(<RequirementEstimates {...p} />);
  expect(screen.getByRole('button', { name: 'Edit complexity REQ-1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit complexity REQ-2' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Explain duration REQ-1' })).toHaveTextContent(
    'No work left',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Explain duration REQ-1' }));
  expect(
    screen.getByText('No implementation work remains in the accepted assessment.'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await userEvent.click(screen.getByRole('button', { name: 'Explain duration REQ-2' }));
  expect(
    screen.getByText('Re-estimate to size the remaining change from code evidence.'),
  ).toBeVisible();
});

test('legacy estimates remain readable and explain how to obtain the new comparisons', () => {
  const p = props();
  p.estimation.estimatorVersion = '1';
  p.estimation.requirements[0]!.remaining = null;
  p.estimation.requirements[0]!.durationDays = 10;
  render(<RequirementEstimates {...p} />);
  expect(screen.getByText(/This saved estimate uses the earlier method/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Explain duration REQ-1' })).toHaveTextContent(
    'Unavailable',
  );
  expect(screen.getByRole('button', { name: 'Re-estimate' })).toBeEnabled();
});
