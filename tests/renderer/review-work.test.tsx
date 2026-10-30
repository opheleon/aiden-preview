import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { TeamTaskStatus } from '../../apps/desktop/src/components/TeamTaskStatus';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';
import { MyWork } from '../../apps/desktop/src/views/MyWork';
import type { AccountState } from '../../packages/contracts/src/accounts-api';
import {
  bob,
  bobStatus,
  legacyReview,
  reviewState,
  reviewTask,
  verifyTask,
} from './review-fixture';

/** A worker bridge that answers the account methods with the review team. */
function fixture(teamState: AccountState = reviewState()) {
  const call = vi.fn((method: string) => {
    if (method === 'accountStatus') return Promise.resolve(bobStatus());
    if (method === 'accountState') return Promise.resolve(teamState);
    return Promise.resolve(null);
  });
  const workspace = {
    call,
    load: vi.fn(() => Promise.resolve()),
    setArea: vi.fn(),
  } as unknown as Workspace;
  return { call, workspace };
}

/** Run a test with a stubbed openExternal bridge. */
async function withBridge(run: (open: ReturnType<typeof vi.fn>) => Promise<void>) {
  const openExternal = vi.fn(async () => {});
  const original = window.aiden;
  window.aiden = { ...original, openExternal } as NonNullable<typeof window.aiden>;
  try {
    await run(openExternal);
  } finally {
    if (original) window.aiden = original;
    else delete window.aiden;
  }
}

test('the reviewer sees Aiden’s work in To review with its PRs and checks, and approves it', async () => {
  await withBridge(async (openExternal) => {
    const f = fixture();
    render(<MyWork workspace={f.workspace} />);
    const card = await screen.findByRole('region', { name: 'To review' });
    expect(card).toHaveTextContent('1');
    expect(card).not.toHaveTextContent('Alice reviews this');
    await userEvent.click(within(card).getByRole('button', { name: /Members sign in/ }));
    expect(card).toHaveTextContent('1 of 2 requirements met');
    const checks = within(card).getByRole('list', { name: 'Checks' });
    expect(checks).toHaveTextContent('Running');
    expect(checks).toHaveTextContent('Passed');
    expect(checks).toHaveTextContent('Needs you');
    // Reviewing is not verifying: manual checks are passed after approval, not here.
    expect(within(card).queryByRole('button', { name: /^Pass:/ })).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Open calendar-api PR' }));
    expect(openExternal).toHaveBeenCalledWith(reviewTask.review!.pullRequestUrls[0]);
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(f.call).toHaveBeenCalledWith('accountReviewTask', {
      taskId: reviewTask.id,
      decision: 'approve',
    });
  });
});

test('Request changes needs a short note before it sends', async () => {
  const f = fixture();
  render(<MyWork workspace={f.workspace} />);
  const card = await screen.findByRole('region', { name: 'To review' });
  await userEvent.click(within(card).getByRole('button', { name: /Members sign in/ }));
  await userEvent.click(within(card).getByRole('button', { name: 'Request changes' }));
  const send = within(card).getByRole('button', { name: 'Send' });
  expect(send).toBeDisabled();
  await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
  expect(within(card).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Request changes' }));
  await userEvent.type(
    within(card).getByLabelText(`What needs to change: ${reviewTask.title}`),
    'Refuse expired invites',
  );
  await userEvent.click(within(card).getByRole('button', { name: 'Send' }));
  expect(f.call).toHaveBeenCalledWith('accountReviewTask', {
    taskId: reviewTask.id,
    decision: 'changes',
    note: 'Refuse expired invites',
  });
});

test('To verify lists the checks and lets the reviewer pass or fail manual ones; legacy reviews stay', async () => {
  await withBridge(async (openExternal) => {
    const f = fixture();
    render(<MyWork workspace={f.workspace} />);
    const card = await screen.findByRole('region', { name: 'To verify' });
    expect(card).toHaveTextContent('2');
    await userEvent.click(within(card).getByRole('button', { name: /Recurring events/ }));
    expect(card).toHaveTextContent('3 checks passed');
    const manual = verifyTask.checks[1]!;
    await userEvent.click(within(card).getByRole('button', { name: `Pass: ${manual.name}` }));
    expect(f.call).toHaveBeenCalledWith('accountCheckTask', {
      taskId: verifyTask.id,
      checkId: manual.id,
      passed: true,
    });
    await userEvent.click(within(card).getByRole('button', { name: `Fail: ${manual.name}` }));
    expect(f.call).toHaveBeenCalledWith('accountCheckTask', {
      taskId: verifyTask.id,
      checkId: manual.id,
      passed: false,
    });
    await userEvent.click(
      within(card).getByRole('button', { name: `Open: ${verifyTask.checks[0]!.name}` }),
    );
    expect(openExternal).toHaveBeenCalledWith(verifyTask.checks[0]!.url);
    await userEvent.click(within(card).getByRole('button', { name: /Review and merge/ }));
    expect(within(card).getByRole('button', { name: 'Open pull request' })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Mark done' }));
    expect(f.call).toHaveBeenCalledWith('accountFinishTask', { taskId: legacyReview.id });
  });
});

test('a waiting verify task says so; nothing shows when the team has nothing for this reviewer', async () => {
  const running = {
    ...verifyTask,
    checks: [{ ...verifyTask.checks[0]!, state: 'pending' as const, detail: null }],
  };
  const f = fixture({ ...reviewState(), tasks: [running] });
  render(<MyWork workspace={f.workspace} />);
  const card = await screen.findByRole('region', { name: 'To verify' });
  await userEvent.click(within(card).getByRole('button', { name: /Recurring events/ }));
  expect(card).toHaveTextContent('One automated check is still running');
  expect(screen.getByRole('region', { name: 'To review' })).toHaveTextContent('Nothing to review.');
});

test('a team project explains review and verification, and can still be stopped', async () => {
  const project = { id: reviewTask.projectId, account: { accountId: 'a', revision: 1 } };
  for (const [task, words] of [
    [reviewTask, `Waiting for ${bob.name} to review it in My work.`],
    [{ ...reviewTask, reviewerUserId: null }, 'Waiting for the team to pick a reviewer.'],
    [verifyTask, 'Approved. 1 of 2 checks passed so far.'],
  ] as const) {
    const f = fixture({ ...reviewState(), tasks: [task] });
    const workspace = { ...f.workspace, project } as unknown as Workspace;
    const { unmount } = render(<TeamTaskStatus workspace={workspace} />);
    const line = await screen.findByRole('region', { name: 'Aiden’s team task' });
    expect(line).toHaveTextContent('In review');
    expect(line).toHaveTextContent(words);
    expect(within(line).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    unmount();
  }
});
