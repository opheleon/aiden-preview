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
    onOpenEvidence: vi.fn(),
  };
}
test('saved report evidence remains accessible while unknown estimates stay explicit', async () => {
  const p = props();
  render(<RequirementEstimates {...p} />);
  expect(screen.getByRole('heading', { name: 'Requirements & estimates' })).toBeVisible();
  expect(screen.getByText('Not assessed')).toBeVisible();
  await userEvent.click(screen.getAllByText('Code evidence')[0]!);
  await userEvent.click(screen.getAllByRole('button', { name: /frontend · app.txt:1/ })[0]!);
  expect(p.onOpenEvidence).toHaveBeenCalledWith(0, 0);
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
    expect.objectContaining({ requirementPoints: { 'REQ-1': 3 } }),
  );
  expect(screen.queryByRole('dialog', { name: 'Complexity' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('manual duration and forecast edits preserve the other override fields', async () => {
  const p = props();
  render(<RequirementEstimates {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit duration REQ-2' }));
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Duration in days REQ-2' }), '4.5');
  await userEvent.click(screen.getByRole('button', { name: 'Save duration' }));
  expect(p.onSave).toHaveBeenLastCalledWith({ ...p.overrides, durations: { 'REQ-2': 4.5 } });
  await userEvent.click(screen.getByRole('button', { name: 'Edit forecast' }));
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Expected points per week' }), '5');
  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Team capacity for this project' }));
  await userEvent.type(
    screen.getByRole('spinbutton', { name: 'Team capacity for this project' }),
    '50',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save forecast' }));
  expect(p.onSave).toHaveBeenLastCalledWith({
    ...p.overrides,
    manualWeeklyRate: 5,
    capacityPercent: 50,
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('forecast write failures remain visible and cancellation does not save', async () => {
  const p = props();
  p.onSave.mockRejectedValue(new Error('Disk full'));
  render(<RequirementEstimates {...p} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit forecast' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save forecast' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(p.onSave).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('manual size and duration can reset independently without discarding other overrides', async () => {
  const p = props();
  Object.assign(p.estimation.requirements[0]!, {
    points: 5,
    pointsOverridden: true,
    durationDays: 1,
    durationOverridden: true,
  });
  p.overrides.requirementPoints = { 'REQ-1': 5 };
  p.overrides.durations = { 'REQ-1': 1 };
  render(<RequirementEstimates {...p} />);
  expect(screen.getByRole('button', { name: 'Edit duration REQ-1' })).toHaveTextContent('1 day');
  await userEvent.click(screen.getByRole('button', { name: 'Edit complexity REQ-1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reset size to suggested' }));
  expect(p.onSave).toHaveBeenLastCalledWith({ ...p.overrides, requirementPoints: {} });
  await userEvent.click(screen.getByRole('button', { name: 'Edit duration REQ-1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reset duration to predicted' }));
  expect(p.onSave).toHaveBeenLastCalledWith({ ...p.overrides, durations: {} });
  await userEvent.click(screen.getByRole('button', { name: 'Edit duration REQ-1' }));
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Configure history' }),
  );
  expect(p.onConfigureHistory).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('historical duration shows only saved comparison links and flags truncated history', async () => {
  const p = props();
  p.estimation.historyTruncated = true;
  p.estimation.history = [1, 2, 3].map((i) => ({
    connectionId: 'fixture',
    sourceId: 'team',
    id: `issue-${i}`,
    identifier: `TEAM-${i}`,
    title: 'Synthetic work',
    description: '',
    url: i === 1 ? 'https://example.invalid/1' : undefined,
    startedAt: null,
    completedAt: null,
    observedCalendarDays: i === 3 ? null : i,
    size: null,
    points: null,
    workType: 'unknown',
    scopeShape: 'unknown',
  }));
  Object.assign(p.estimation.requirements[0]!, {
    suggestedDurationDays: 2,
    durationDays: 2,
    comparisons: ['issue-1', 'issue-2', 'issue-3', 'unavailable'],
  });
  render(<RequirementEstimates {...p} />);
  expect(screen.getByText('History reached its configured collection limit.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Edit duration REQ-1' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByRole('button', { name: 'Configure history' })).not.toBeInTheDocument();
  await userEvent.click(dialog.getByText('4 similar completed issues'));
  await userEvent.click(dialog.getByRole('button', { name: 'TEAM-1 · Synthetic work' }));
  expect(p.onOpenExternal).toHaveBeenCalledWith('https://example.invalid/1');
  await userEvent.click(dialog.getByRole('button', { name: 'TEAM-2 · Synthetic work' }));
  expect(p.onOpenExternal).toHaveBeenCalledOnce();
  expect(dialog.queryByText('unavailable')).not.toBeInTheDocument();
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
