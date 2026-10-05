import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { ProjectOutcome } from '../../apps/desktop/src/components/ProjectOutcome';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';

function fixture() {
  const project = {
    id: 'project',
    lifecycle: {
      status: 'active',
      evidenceKey: 'a'.repeat(64),
      acceptanceCurrent: false,
      history: [],
    },
  };
  const workspace = {
    project,
    baseline: {},
    report: {},
    busy: false,
    call: vi.fn().mockResolvedValue(project),
    setProject: vi.fn(),
    setProjects: vi.fn(),
    action: vi.fn((fn) => fn()),
  };
  return workspace as unknown as Workspace & { call: ReturnType<typeof vi.fn> };
}

test('acceptance requires a note, keeps a failed submission available, and submits the displayed evidence identity', async () => {
  const f = fixture();
  f.call.mockRejectedValueOnce(
    new Error('The scope or evidence changed. Review the latest project before accepting.'),
  );
  render(<ProjectOutcome workspace={f} />);
  await userEvent.click(screen.getByRole('button', { name: 'Accept outcome' }));
  const dialog = screen.getByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Accept outcome' });
  expect(submit).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText('Acceptance note'),
    'Reviewed manually, remaining gaps accepted.',
  );
  await userEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('scope or evidence changed');
  expect(screen.getByLabelText('Acceptance note')).toHaveValue(
    'Reviewed manually, remaining gaps accepted.',
  );
  await userEvent.click(submit);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.call).toHaveBeenLastCalledWith('acceptOutcome', {
    projectId: 'project',
    note: 'Reviewed manually, remaining gaps accepted.',
    evidenceKey: 'a'.repeat(64),
  });
  expect(f.setProject).toHaveBeenCalled();
});

test('closing is independent of acceptance, cancel returns focus, and reopen is explicit', async () => {
  const f = fixture();
  const view = render(<ProjectOutcome workspace={f} />);
  const close = screen.getByRole('button', { name: 'Close project' });
  await userEvent.click(close);
  expect(screen.getByRole('dialog')).toHaveTextContent('does not mark its outcome as accepted');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(close).toHaveFocus();
  expect(f.call).not.toHaveBeenCalled();
  await userEvent.click(close);
  await userEvent.type(screen.getByLabelText('Closing note'), 'Cancelled this initiative.');
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Close project' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(f.call).toHaveBeenCalledWith('closeProject', {
    projectId: 'project',
    note: 'Cancelled this initiative.',
  });
  f.project.lifecycle!.status = 'closed';
  view.rerender(<ProjectOutcome workspace={f} />);
  expect(screen.getByText('Monitoring and ticket syncing are paused.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reopen project' }));
  expect(f.call).toHaveBeenCalledWith('reopenProject', { projectId: 'project' });
});

test('current and superseded acceptances stay distinct, with notes in decision history', async () => {
  const f = fixture();
  const lifecycle = f.project.lifecycle!;
  lifecycle.acceptance = {
    at: '2026-10-04T00:00:00.000Z',
    evidenceKey: lifecycle.evidenceKey,
    note: 'Reviewed on a device.',
  };
  lifecycle.acceptanceCurrent = true;
  lifecycle.history = [{ ...lifecycle.acceptance, action: 'accepted' }];
  const view = render(<ProjectOutcome workspace={f} />);
  expect(screen.getByRole('button', { name: 'Update acceptance' })).toBeEnabled();
  await userEvent.click(screen.getByText('Decision history'));
  expect(screen.getByText('Reviewed on a device.')).toBeVisible();
  lifecycle.acceptanceCurrent = false;
  view.rerender(<ProjectOutcome workspace={f} />);
  expect(screen.getByText(/Scope or evidence changed since acceptance/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Accept outcome' })).toBeEnabled();
  f.busy = true;
  view.rerender(<ProjectOutcome workspace={f} />);
  expect(screen.getByRole('button', { name: 'Accept outcome' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close project' })).toBeDisabled();
});

test('a brand-new project offers no outcome until a check has run, unless it has decisions', () => {
  const f = fixture();
  const { container, rerender } = render(
    <ProjectOutcome workspace={{ ...f, report: undefined }} />,
  );
  expect(container).toBeEmptyDOMElement();
  const closed = {
    ...f,
    report: undefined,
    project: { ...f.project, lifecycle: { ...f.project.lifecycle!, status: 'closed' as const } },
  };
  rerender(<ProjectOutcome workspace={closed} />);
  expect(screen.getByRole('button', { name: 'Reopen project' })).toBeVisible();
});
