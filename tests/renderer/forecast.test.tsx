import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { ForecastControls } from '../../apps/desktop/src/views/ForecastControls';
import { defaultOverrides } from '../../packages/estimation/src/index';
import { estimateFixture } from './fixtures';

test('forecast controls submit explicit capacity, rate, and target while preserving saved estimates', async () => {
  const estimation = estimateFixture();
  const call = vi.fn().mockResolvedValue(estimation);
  const setEstimation = vi.fn();
  const setNotice = vi.fn();
  function Forecast() {
    const [overrides, setOverrides] = useState(defaultOverrides());
    return (
      <ForecastControls
        overrides={overrides}
        setOverrides={setOverrides}
        action={async (fn) => fn()}
        call={call}
        project={{
          id: 'fixture',
          name: 'Fixture',
          context: '',
          repositories: [],
          runtime: { provider: 'codex', auth: 'subscription' },
        }}
        setEstimation={setEstimation}
        overridesFrom={defaultOverrides}
        setNotice={setNotice}
      />
    );
  }
  render(<Forecast />);
  await userEvent.type(screen.getByLabelText('Manual weekly rate'), '8');
  await userEvent.selectOptions(screen.getByLabelText('Project capacity'), '50');
  fireEvent.change(screen.getByLabelText('Target date'), { target: { value: '2026-12-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'Update forecast' }));
  expect(call).toHaveBeenCalledWith('estimateOverrides', {
    projectId: 'fixture',
    overrides: {
      ...defaultOverrides(),
      manualWeeklyRate: 8,
      capacityPercent: 50,
      targetDate: '2026-12-01',
    },
  });
  expect(setEstimation).toHaveBeenCalledWith(estimation);
  expect(setNotice).toHaveBeenCalledWith('Forecast settings saved.');
  expect(screen.getByLabelText('Manual weekly rate')).toHaveValue(null);
});
