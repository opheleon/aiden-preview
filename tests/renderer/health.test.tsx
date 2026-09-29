import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import ProjectHealth from '../../apps/desktop/src/components/ProjectHealth';
import { estimateFixture, report } from './fixtures';

test('scope summary preserves weighted progress and never presents a legacy manual forecast', () => {
  const estimation = estimateFixture();
  Object.assign(estimation.forecast, {
    implementedPercent: 50,
    implementedPoints: 2,
    remainingPoints: 2,
    forecastFinish: '2026-10-05',
    weeklyRate: 4,
    rateSource: 'manual',
  });
  const { rerender } = render(<ProjectHealth estimation={estimation} report={report} />);
  expect(screen.getByRole('progressbar', { name: 'Scope implemented' })).toHaveValue(50);
  expect(screen.queryByRole('button', { name: /forecast|delivery rate/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/Oct 5/)).not.toBeInTheDocument();
  expect(screen.getByText(/They are not added into a project finish date/)).toBeVisible();
  expect(screen.getByText(/Code assessment does not confirm deployment/)).toBeInTheDocument();
  estimation.forecast.implementedPercent = null;
  estimation.forecast.remainingPoints = null;
  rerender(<ProjectHealth estimation={estimation} report={report} />);
  expect(screen.getByText('Not assessed')).toBeVisible();
  expect(screen.getByText('Unknown')).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
