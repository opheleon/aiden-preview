import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { TeamTaskStatus } from '../../apps/desktop/src/components/TeamTaskStatus';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';
import { AccountWork } from '../../apps/desktop/src/views/AccountWork';
import { MyWork } from '../../apps/desktop/src/views/MyWork';
import state from '../../packages/contracts/fixtures/accounts/account-state.json';
import type { AccountStatus } from '../../packages/contracts/src/api';

/** Account status as the worker returns it; synthetic. */
function status(overrides: Partial<AccountStatus> = {}): AccountStatus {
  return {
    signedIn: true,
    email: 'bob@example.com',
    userId: '00000000-0000-4000-8000-000000000003',
    accounts: [{ id: state.account.id, name: state.account.name }],
    message: null,
    deviceName: 'Bob MacBook',
    pickupEnabled: true,
    usageCapPct: 70,
    signingIn: false,
    running: null,
    last: {
      type: 'hold',
      reason: 'Holding for a better-suited machine',
      at: '2026-10-20T15:00:00.000Z',
    },
    ...overrides,
  };
}

/** A worker bridge that answers the account methods. */
function fixture(current: AccountStatus, teamState: object = state, projects: object[] = []) {
  const call = vi.fn((method: string) => {
    if (method === 'accountShareProject') return Promise.resolve({ id: 'synced' });
    if (method === 'projects') return Promise.resolve(projects);
    if (method === 'accountStatus' || method === 'accountSetPickup')
      return Promise.resolve(current);
    if (method === 'accountState') return Promise.resolve(teamState);
    if (method === 'accountSignInStart')
      return Promise.resolve({
        challengeId: 'challenge-1',
        expiresInSeconds: 600,
        demoCode: '123456',
      });
    if (method === 'accountSignInVerify') return Promise.resolve({ email: 'bob@example.com' });
    return Promise.resolve(null);
  });
  const load = vi.fn(() => Promise.resolve());
  const setArea = vi.fn();
  const setAccountScope = vi.fn();
  const setProjects = vi.fn();
  const workspace = {
    call,
    load,
    setArea,
    setAccountScope,
    projects,
    setProjects,
  } as unknown as Workspace;
  return { call, load, setArea, workspace };
}

test('signed out, one button opens the browser; while it waits the screen says so', async () => {
  const f = fixture(status({ signedIn: false, email: null, userId: null, accounts: [] }));
  const { unmount } = render(<AccountWork workspace={f.workspace} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(f.call).toHaveBeenCalledWith('accountSignIn');
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  unmount();
  const waiting = fixture(
    status({ signedIn: false, email: null, userId: null, accounts: [], signingIn: true }),
  );
  render(<AccountWork workspace={waiting.workspace} />);
  expect(await screen.findByText(/Finish signing in in your browser/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
});

test('a sign-in for an email on no team is refused with the reason, and nothing here joins or creates a team', async () => {
  const reason =
    'dana@example.com is not on an Aiden Teams team. Accept your team’s invitation in the Teams dashboard, or sign in with the email your team invited.';
  const f = fixture(
    status({ signedIn: false, email: null, userId: null, accounts: [], message: reason }),
  );
  render(<AccountWork workspace={f.workspace} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(reason);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByText(/create your account/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /join|create|dashboard/i })).not.toBeInTheDocument();
});

test('projects made on this computer sync into the team one at a time, by choice', async () => {
  const local = { id: 'local-1', name: 'Zoom calendar' };
  const shared = {
    id: 'team-1',
    name: 'Books',
    account: { accountId: state.account.id, revision: 2 },
  };
  const f = fixture(status(), state, [local, shared]);
  render(<AccountWork workspace={f.workspace} />);
  const card = await screen.findByRole('region', { name: 'Projects on this Mac' });
  expect(card).toHaveTextContent('Zoom calendar');
  expect(card).not.toHaveTextContent('Books');
  await userEvent.click(
    within(card).getByRole('button', { name: `Sync to ${state.account.name}` }),
  );
  expect(f.call).toHaveBeenCalledWith('accountShareProject', {
    accountId: state.account.id,
    projectId: 'local-1',
  });
  expect(f.call).toHaveBeenCalledWith('projects');
});

test('My work puts Aiden’s question in its own card and answers it in place', async () => {
  const f = fixture(
    status({ userId: state.tasks.find((t) => t.actor === 'human')!.assigneeUserId }),
  );
  render(<MyWork workspace={f.workspace} />);
  const questions = await screen.findByRole('region', { name: 'Questions for you' });
  expect(screen.getByText('Holding for a better-suited machine')).toBeInTheDocument();
  const loads = f.call.mock.calls.filter(([method]) => method === 'accountState').length;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(f.call.mock.calls.filter(([method]) => method === 'accountState').length).toBeGreaterThan(
    loads,
  );
  expect(questions).toHaveTextContent('Invoice payments');
  expect(screen.queryByLabelText('Answer: Which currency?')).not.toBeInTheDocument();
  await userEvent.click(within(questions).getByRole('button', { name: /Which currency\?/ }));
  await userEvent.type(screen.getByLabelText('Answer: Which currency?'), 'USD only');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(f.call).toHaveBeenCalledWith('accountFinishTask', {
    taskId: state.tasks.find((t) => t.actor === 'human')?.id,
    answer: 'USD only',
  });
  expect(screen.getByRole('region', { name: 'To verify' })).toHaveTextContent(
    'Nothing to look over.',
  );
  expect(screen.queryByText('Write requirements')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'This machine' })).not.toBeInTheDocument();
});

test('a coding question shows its formatted text and records a typed answer on the server', async () => {
  const human = state.tasks.find((t) => t.actor === 'human')!;
  const question = {
    ...human,
    kind: 'coding-question',
    title: 'Which plan names?',
    instructions:
      'Claude Code paused here.\n- Starter and Pro\n- Basic and Plus\n\nSee `plans.ts`.',
  };
  const f = fixture(status({ userId: human.assigneeUserId }), { ...state, tasks: [question] });
  render(<MyWork workspace={f.workspace} />);
  const questions = await screen.findByRole('region', { name: 'Questions for you' });
  await userEvent.click(within(questions).getByRole('button', { name: /Which plan names\?/ }));
  expect(within(questions).getByText('Starter and Pro').tagName).toBe('LI');
  expect(within(questions).getByText('plans.ts').tagName).toBe('CODE');
  const box = screen.getByLabelText('Answer: Which plan names?');
  await userEvent.type(box, 'Starter and Pro{Control>}{Enter}{/Control}');
  expect(f.call).toHaveBeenCalledWith('accountFinishTask', {
    taskId: question.id,
    answer: 'Starter and Pro',
  });
  await userEvent.click(within(questions).getByRole('button', { name: 'Mark done' }));
  expect(f.call).toHaveBeenCalledWith('accountFinishTask', { taskId: question.id });
});

test('a setup step lands in For you to do and closes from the project, not here', async () => {
  const human = state.tasks.find((t) => t.actor === 'human')!;
  const setup = { ...human, kind: 'setup-code', title: 'Connect code' };
  const f = fixture(status({ userId: human.assigneeUserId }), { ...state, tasks: [setup] });
  render(<MyWork workspace={f.workspace} />);
  const todo = await screen.findByRole('region', { name: 'For you to do' });
  await userEvent.click(within(todo).getByRole('button', { name: /Connect code/ }));
  expect(within(todo).queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  await userEvent.click(within(todo).getByRole('button', { name: 'Open project' }));
  expect(f.load).toHaveBeenCalledWith(setup.projectId);
  await vi.waitFor(() => expect(f.setArea).toHaveBeenCalledWith('projects'));
  expect(screen.getByText('No questions right now.')).toBeInTheDocument();
});

test('Teams settings show the team, its machines, and this machine', async () => {
  const f = fixture(status());
  render(<AccountWork workspace={f.workspace} />);
  expect(await screen.findByRole('region', { name: 'Machines' })).toHaveTextContent(
    'Alice MacBook',
  );
  expect(screen.queryByRole('region', { name: 'Your tasks' })).not.toBeInTheDocument();
  const machine = screen.getByRole('region', { name: 'This machine' });
  expect(machine).toHaveTextContent('Holding for a better-suited machine');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pick up team work' }));
  expect(f.call).toHaveBeenCalledWith('accountSetPickup', { pickupEnabled: false });
});

test('the team owner sees members but manages invites and admins in the dashboard', async () => {
  const f = fixture(status({ userId: state.members[0]!.id, email: 'alice@example.com' }));
  render(<AccountWork workspace={f.workspace} />);
  const members = await screen.findByRole('region', { name: 'Members' });
  expect(within(members).getByText('BOB')).toBeInTheDocument();
  expect(within(members).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Invite someone/ })).not.toBeInTheDocument();
});

test('a team project says why Aiden’s task waits, and Stop or Try again changes it', async () => {
  const agent = state.tasks.find((t) => t.actor === 'agent')!;
  const failing = {
    ...agent,
    status: 'queued' as const,
    attempts: 2,
    result: { error: 'This machine could not copy the project’s code from GitHub' },
  };
  const f = fixture(status(), { ...state, tasks: [failing] });
  const project = { id: agent.projectId, account: { accountId: state.account.id, revision: 1 } };
  const workspace = { ...f.workspace, project } as unknown as Workspace;
  render(<TeamTaskStatus workspace={workspace} />);
  const line = await screen.findByRole('region', { name: 'Aiden’s team task' });
  expect(line).toHaveTextContent('Write requirements');
  expect(line).toHaveTextContent('To do');
  expect(line).toHaveTextContent('Tried 2 times. Last error: This machine could not copy');
  await userEvent.click(within(line).getByRole('button', { name: 'Stop' }));
  expect(f.call).toHaveBeenCalledWith('accountCancelTask', { taskId: agent.id });
});

test('every signed-in person has a global profile link, while only admins have team settings', async () => {
  const openExternal = vi.fn(async () => {});
  const original = window.aiden;
  window.aiden = { ...original, openExternal } as NonNullable<typeof window.aiden>;
  try {
    const noTeam = fixture(
      status({
        accounts: [],
        profile: { name: 'Updated person', avatar: 'data:image/png;base64,AAAA' },
        settingsUrl: 'https://teams.example.com',
      }),
    );
    const first = render(<AccountWork workspace={noTeam.workspace} />);
    expect(await screen.findByText('Updated person')).toBeInTheDocument();
    expect(screen.getByAltText('Your profile')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    );
    await userEvent.click(screen.getByRole('button', { name: 'My profile' }));
    expect(openExternal).toHaveBeenCalledWith('https://teams.example.com/profile');
    expect(screen.queryByRole('button', { name: 'Team settings' })).not.toBeInTheDocument();
    first.unmount();
    const admin = state.members.find((member) => member.isAdmin)!;
    const current = fixture(status({ userId: admin.id, settingsUrl: 'https://teams.example.com' }));
    render(<AccountWork workspace={current.workspace} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Team settings' }));
    expect(openExternal).toHaveBeenCalledWith(
      `https://teams.example.com/team?team=${state.account.id}`,
    );
  } finally {
    if (original) window.aiden = original;
    else delete window.aiden;
  }
});
