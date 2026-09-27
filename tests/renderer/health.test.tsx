import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import ProjectHealth from '../../apps/desktop/src/components/ProjectHealth';
import { defaultOverrides } from '../../packages/estimation/src/index';
import { estimateFixture, report } from './fixtures';

test.each([
  [0, 'On target'],
  [1, '1 working day after target'],
  [-2, '2 working days before target'],
] as const)(
  'known forecasts explain target variance %s without implying deployment',
  (variance, label) => {
    const estimation = estimateFixture();
    Object.assign(estimation.forecast, {
      completeCoverage: true,
      implementedPercent: 50,
      implementedPoints: 2,
      remainingPoints: 2,
      remainingWorkingDays: 3,
      forecastFinish: '2026-10-05',
      targetDate: '2026-10-05',
      targetVarianceWorkingDays: variance,
      weeklyRate: 4,
      rateSource: 'history',
    });
    render(
      <ProjectHealth
        estimation={estimation}
        report={{ ...report, deviations: [] }}
        overrides={defaultOverrides()}
        onSave={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Scope implemented' })).toHaveValue(50);
    expect(screen.getByRole('button', { name: 'Edit forecast' })).toHaveTextContent(label);
    expect(screen.getByText(/Expected delivery: 4.0 points\/week · team history/)).toBeVisible();
    expect(screen.getByText(/Code assessment does not confirm deployment/)).toBeInTheDocument();
  },
);

test('complete, unsized, and uncalibrated scope have distinct forecast explanations', () => {
  const estimation = estimateFixture();
  estimation.forecast.completeCoverage = true;
  const props = { estimation, report, overrides: defaultOverrides(), onSave: vi.fn(), busy: false };
  const { rerender } = render(<ProjectHealth {...props} />);
  expect(screen.getByRole('button', { name: 'Edit forecast' })).toHaveTextContent(
    'Estimate remaining work from the latest assessment',
  );
  estimation.forecast.remainingPoints = 2;
  rerender(<ProjectHealth {...props} />);
  expect(screen.getByRole('button', { name: 'Edit forecast' })).toHaveTextContent(
    'Set delivery rate to forecast',
  );
  estimation.forecast.remainingPoints = 0;
  estimation.forecast.implementedPercent = 100;
  rerender(<ProjectHealth {...props} />);
  expect(screen.getByRole('button', { name: 'Edit forecast' })).toHaveTextContent(
    'No implementation scope remaining',
  );
});

test('switching to the team rate preserves capacity and the edited target date', async () => {
  const estimation = estimateFixture();
  estimation.historyComplete = true;
  estimation.historyCollectedAt = '2026-09-26T12:00:00Z';
  estimation.history = Array.from({ length: 3 }, (_, i) => ({
    connectionId: 'fixture',
    sourceId: 'team',
    id: `issue-${i}`,
    identifier: `TEAM-${i}`,
    title: 'Synthetic work',
    description: '',
    startedAt: null,
    completedAt: null,
    observedCalendarDays: null,
    size: null,
    points: null,
    workType: 'unknown',
    scopeShape: 'unknown',
  }));
  const overrides = {
    ...defaultOverrides(),
    manualWeeklyRate: 5,
    capacityPercent: 50,
    targetDate: '2026-10-01',
  };
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectHealth
      estimation={estimation}
      report={report}
      overrides={overrides}
      onSave={onSave}
      busy={false}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit forecast' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Project forecast' }));
  expect(dialog.getByText(/Team history includes 3 completed issues/)).toBeVisible();
  fireEvent.change(dialog.getByLabelText('Target date'), { target: { value: '2026-11-01' } });
  await userEvent.click(dialog.getByRole('button', { name: 'Use team rate' }));
  expect(onSave).toHaveBeenCalledWith({
    ...overrides,
    manualWeeklyRate: null,
    targetDate: '2026-11-01',
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
