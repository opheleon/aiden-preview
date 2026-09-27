import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';

import { GoalStarter } from '../../apps/desktop/src/views/GoalStarter';
import type { Project } from '../../packages/contracts/src/index';

function Setup() {
  const [project, setProject] = useState<Project>({
    id: 'fixture',
    name: '',
    context: '',
    repositories: [],
    runtime: { provider: 'codex', auth: 'subscription' },
  });
  const [show, setShow] = useState(true);
  return show ? (
    <GoalStarter project={project} setProject={setProject} setShowGoalStarter={setShow} />
  ) : (
    <p>
      Ready to choose repositories for {project.runtime.provider}: {project.context}
    </p>
  );
}

test('setup requires a nonblank goal and preserves the chosen provider', async () => {
  render(<Setup />);
  const create = screen.getByRole('button', { name: /Create project/ });
  expect(create).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Project description'), '   ');
  expect(create).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('Project description'));
  await userEvent.type(screen.getByLabelText('Project description'), 'Users can list books');
  await userEvent.selectOptions(screen.getByLabelText('Model runtime'), 'claude');
  await userEvent.click(create);
  expect(
    screen.getByText('Ready to choose repositories for claude: Users can list books'),
  ).toBeVisible();
});
