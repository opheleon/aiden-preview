import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import type { GuideView } from '../../packages/contracts/src/guide';
import { appFixture, openCall } from './app-fixture';
import { report } from './fixtures';
const f = appFixture();
const request = f.request.getMockImplementation()!;
const { default: App } = await import('../../apps/desktop/src/App');
beforeEach(() => {
  f.reset();
  f.request.mockImplementation(request);
});

/** Open the synthetic project as a fresh one: no confirmed requirements and no finished check. */
async function openFreshProject() {
  f.setSetupPending();
  f.clearRuns();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
}

test('a new project opens on the Guide, plays back the requirements, and sets up a web check', async () => {
  await openFreshProject();
  const dialog = await screen.findByRole('dialog', { name: 'Chat with Aiden' });
  expect(dialog).toBeVisible();
  expect(screen.queryByRole('tab', { name: /Guide/ })).not.toBeInTheDocument();
  const setup = screen.getByRole('list', { name: 'Setup' });
  expect(within(setup).getByText('Review requirements')).toBeVisible();
  // The playback starts on its own once the requirements exist.
  expect(await screen.findByText(/Synthetic playback of the requirements/)).toBeVisible();
  expect(within(dialog).getByText('Step 2 of 4 · Review requirements')).toBeVisible();
  await userEvent.type(within(dialog).getByLabelText('Message the Guide'), 'Keep this draft');
  const requestsBeforeHelp = f.request.mock.calls.length;
  for (const label of [
    'Define goal',
    'Review requirements',
    'Choose checks',
    'First check',
    'Extras',
  ]) {
    const icon = within(dialog).getByRole('button', { name: `About ${label}` });
    await userEvent.hover(icon);
    expect(within(dialog).getByRole('tooltip', { name: `About ${label}` })).toBeVisible();
    await userEvent.unhover(icon);
    expect(within(dialog).queryByRole('tooltip')).toBeNull();
    expect(within(dialog).getByLabelText('Message the Guide')).toHaveValue('Keep this draft');
  }
  expect(f.request.mock.calls.length).toBe(requestsBeforeHelp);
  act(() => within(dialog).getByRole('button', { name: 'About Extras' }).focus());
  expect(within(dialog).getByRole('tooltip', { name: 'About Extras' })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(dialog).toBeVisible();
  expect(within(dialog).queryByRole('tooltip')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'About Extras' })).toHaveFocus();
  expect(f.request).toHaveBeenCalledWith('askGuide', { projectId: f.project().id, kickoff: true });
  expect(
    within(screen.getByRole('dialog', { name: 'Chat with Aiden' })).getByText('REQ-1'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Looks right' }));
  expect(f.request).toHaveBeenCalledWith('confirmRequirements', { projectId: f.project().id });
  expect(await screen.findByText(/how should Aiden check the work/)).toBeVisible();
  const methods = screen.getByRole('group', { name: 'How should Aiden check the work?' });
  expect(within(methods).queryByText('Recommended')).not.toBeInTheDocument();
  expect(within(methods).queryByRole('checkbox', { name: /iPhone/ })).not.toBeInTheDocument();
  expect(within(methods).getAllByRole('checkbox').at(-1)).toHaveAccessibleName(
    /I'll check it myself/,
  );
  await userEvent.click(within(methods).getByRole('checkbox', { name: /Web app/ }));
  await userEvent.type(screen.getByLabelText('Where does the app run?'), 'http://localhost:3000');
  await userEvent.hover(within(dialog).getByRole('button', { name: 'About Choose checks' }));
  await userEvent.unhover(within(dialog).getByRole('button', { name: 'About Choose checks' }));
  expect(screen.getByLabelText('Where does the app run?')).toHaveValue('http://localhost:3000');
  expect(screen.getByRole('button', { name: 'Confirm setup' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  expect(await screen.findByText('Access checked. You can confirm this setup.')).toBeVisible();
  expect(f.request).toHaveBeenCalledWith(
    'configureGuideVerification',
    expect.objectContaining({ save: false }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirm setup' }));
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith('configureGuideVerification', {
      projectId: f.project().id,
      save: true,
      code: f.project(),
      update: {
        url: 'http://localhost:3000',
        api: null,
        webLogin: null,
        trigger: 'manual',
        manual: false,
      },
    }),
  );
  expect(f.request).toHaveBeenCalledWith('askGuide', {
    projectId: f.project().id,
    text: 'I checked access and confirmed these verification methods: Connect the code, Web app.',
  });
  expect(await screen.findByText('Step 4 of 4 · First check')).toBeVisible();
});

test('a typed message round-trips, and an unanswered one can be asked again', async () => {
  await openFreshProject();
  await screen.findByText(/Synthetic playback of the requirements/);
  const box = screen.getByLabelText('Message the Guide');
  await userEvent.type(box, 'fail{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('The Guide could not answer that');
  expect(screen.getByText('No reply yet.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Ask again' }));
  expect(f.request).toHaveBeenCalledWith('askGuide', { projectId: f.project().id, retry: true });
  await userEvent.type(box, 'When did you last check?{Enter}');
  expect(await screen.findByText('When did you last check?')).toBeVisible();
  expect(f.guideMessages().at(-1)?.from).toBe('aiden');
});

test('choosing to check by hand saves manual verification', async () => {
  await openFreshProject();
  await userEvent.click(await screen.findByRole('button', { name: 'Looks right' }));
  const methods = await screen.findByRole('group', { name: 'How should Aiden check the work?' });
  await userEvent.click(within(methods).getByRole('checkbox', { name: /check it myself/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm setup' }));
  await waitFor(() =>
    expect(f.request).toHaveBeenCalledWith(
      'configureGuideVerification',
      expect.objectContaining({
        save: true,
        update: expect.objectContaining({ manual: true }),
      }),
    ),
  );
  // Checking by hand needs no automatic first check, so setup is complete.
  expect(await screen.findByText(/Setup complete/)).toBeVisible();
});

test('a checked project with unfinished setup stays on Overview with a banner to the Guide', async () => {
  f.setSetupPending();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  expect(await screen.findByText('Finish setup:')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Open the Guide' }));
  expect(screen.getByRole('dialog', { name: 'Chat with Aiden' })).toBeVisible();
});

test('Back preserves the project tab and draft, and chat also opens over Settings', async () => {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Scope' }));
  const trigger = screen.getByRole('button', { name: 'Ask Aiden' });
  await userEvent.click(trigger);
  await screen.findByText(/Synthetic playback/);
  await userEvent.type(screen.getByLabelText('Message the Guide'), 'Keep this draft');
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.queryByRole('dialog', { name: 'Chat with Aiden' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Scope' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
  await userEvent.click(screen.getByRole('button', { name: 'Ask Aiden about this project' }));
  expect(screen.getByLabelText('Message the Guide')).toHaveValue('Keep this draft');
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: /Application settings/ })).toBeVisible();
  expect(
    f.request.mock.calls.filter(([method, params]) => method === 'askGuide' && params?.kickoff),
  ).toHaveLength(1);
});

test('Enter while a reply is pending preserves the draft and does not submit twice', async () => {
  await openFreshProject();
  await screen.findByText(/Synthetic playback/);
  const original = f.request.getMockImplementation()!;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.request.mockImplementation(async (method, params) => {
    if (method === 'askGuide' && params?.text === 'Slow question') await pending;
    return original(method, params);
  });
  const box = screen.getByLabelText('Message the Guide');
  await userEvent.type(box, 'Slow question{Enter}');
  await screen.findByRole('status', { name: 'Aiden is thinking' });
  await userEvent.type(box, 'Next question{Enter}');
  expect(box).toHaveValue('Next question');
  expect(
    f.request.mock.calls.filter(
      ([method, params]) => method === 'askGuide' && params?.text === 'Next question',
    ),
  ).toHaveLength(0);
  await act(async () => {
    finish();
    await pending;
  });
  await waitFor(() =>
    expect(screen.queryByRole('status', { name: 'Aiden is thinking' })).not.toBeInTheDocument(),
  );
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}more');
  expect(box).toHaveValue('Next question\nmore');
});

test('multiple selections require a fresh successful access check after any edit, and failures cannot confirm', async () => {
  await openFreshProject();
  await userEvent.click(await screen.findByRole('button', { name: 'Looks right' }));
  const methods = await screen.findByRole('group', { name: 'How should Aiden check the work?' });
  await userEvent.click(within(methods).getByRole('checkbox', { name: /Web app/ }));
  await userEvent.click(within(methods).getByRole('checkbox', { name: /^API/ }));
  await userEvent.type(screen.getByLabelText('Where does the app run?'), 'http://localhost:3000');
  await userEvent.type(screen.getByLabelText('API base URL'), 'http://localhost:3001');
  const confirm = screen.getByRole('button', { name: 'Confirm setup' });
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.type(screen.getByLabelText('API base URL'), '/api');
  expect(confirm).toBeDisabled();
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation((method, params) =>
    method === 'configureGuideVerification'
      ? Promise.reject(new Error('API: Nothing answered. Start the app and try again.'))
      : original(method, params),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('API: Nothing answered');
  expect(confirm).toBeDisabled();
  expect(
    f.request.mock.calls.filter(
      ([method, params]) => method === 'configureGuideVerification' && params?.save,
    ),
  ).toHaveLength(0);
  f.request.mockImplementation(original);
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  await userEvent.click(confirm);
  expect(f.request).toHaveBeenCalledWith(
    'configureGuideVerification',
    expect.objectContaining({
      save: true,
      update: expect.objectContaining({
        url: 'http://localhost:3000',
        api: { url: 'http://localhost:3001/api', allowMutations: false, keyHeader: 'X-API-Key' },
      }),
    }),
  );
});

test('manual-only setup confirms directly without a meaningless connection check', async () => {
  f.project().repositories = [];
  await openFreshProject();
  await userEvent.click(await screen.findByRole('button', { name: 'Looks right' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: /check it myself/ }));
  expect(screen.queryByRole('button', { name: 'Check access' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm setup' }));
  expect(await screen.findByText(/Setup complete/)).toBeVisible();
});

test('private login and key fields go directly to the worker, and editing a secret invalidates the access check', async () => {
  await openFreshProject();
  await userEvent.click(await screen.findByRole('button', { name: 'Looks right' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Web app' }));
  await userEvent.type(
    screen.getByLabelText('Where does the app run?'),
    'http://localhost:4317/app',
  );
  await userEvent.click(screen.getByLabelText('Sign in before testing'));
  await userEvent.type(screen.getByLabelText('Login page URL'), 'http://localhost:4317/login');
  expect(screen.queryByLabelText('Text visible after sign-in')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Test account email'), 'demo@local.test');
  await userEvent.type(screen.getByLabelText('Test account password'), 'fixture-password');
  expect(screen.getByLabelText('Test account password')).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('checkbox', { name: 'API' }));
  await userEvent.type(screen.getByLabelText('API base URL'), 'http://localhost:4317/api/');
  await userEvent.type(screen.getByLabelText('API key', { exact: true }), 'fixture-key');
  expect(screen.getByLabelText('API key', { exact: true })).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  const confirm = screen.getByRole('button', { name: 'Confirm setup' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.type(screen.getByLabelText('API key', { exact: true }), '-updated');
  expect(confirm).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Check access' }));
  const original = f.request.getMockImplementation()!;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.request.mockImplementation(async (method, params) => {
    if (method === 'askGuide') await pending;
    return original(method, params);
  });
  await userEvent.click(confirm);
  await waitFor(() => expect(screen.queryByLabelText('Test account password')).toBeNull());
  expect(screen.queryByLabelText('Test account email')).toBeNull();
  expect(screen.queryByLabelText('API key', { exact: true })).toBeNull();
  finish();
  expect(f.request).toHaveBeenCalledWith(
    'configureGuideVerification',
    expect.objectContaining({
      save: true,
      update: expect.objectContaining({
        webCredentials: { username: 'demo@local.test', password: 'fixture-password' },
        apiKey: 'fixture-key-updated',
      }),
    }),
  );
  const chatRequests = f.request.mock.calls.filter(([method]) => method === 'askGuide');
  expect(JSON.stringify(chatRequests)).not.toContain('fixture-password');
  expect(JSON.stringify(chatRequests)).not.toContain('fixture-key');
  expect(JSON.stringify(localStorage)).not.toContain('fixture-password');
  expect(JSON.stringify(localStorage)).not.toContain('fixture-key');
});

test('clarification choices wait for the introduction and retain selections through a follow-up reply', async () => {
  const original = f.request.getMockImplementation()!;
  let release!: () => void;
  let pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.request.mockImplementation(async (method, params) => {
    if (method === 'askGuide') await pending;
    const result = await original(method, params);
    return method === 'guide' || method === 'askGuide'
      ? { ...(result as GuideView), clarifications: [openCall()] }
      : result;
  });
  await openFreshProject();
  const chat = await screen.findByRole('dialog', { name: 'Chat with Aiden' });
  expect(await within(chat).findByRole('status', { name: 'Aiden is thinking' })).toBeVisible();
  expect(within(chat).queryByRole('group', { name: 'Answer choices' })).toBeNull();
  await act(async () => {
    release();
    await pending;
  });
  expect(await within(chat).findByText(/Synthetic playback of the requirements/)).toBeVisible();
  await userEvent.click(await within(chat).findByRole('button', { name: 'Allow duplicates' }));
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await userEvent.type(
    within(chat).getByLabelText('Message the Guide'),
    'Explain the options{Enter}',
  );
  expect(within(chat).queryByRole('group', { name: 'Answer choices' })).toBeNull();
  await act(async () => {
    release();
    await pending;
  });
  expect(await within(chat).findByRole('button', { name: 'Allow duplicates' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  f.request.mockImplementation(original);
});

test('progress replaces the current activity without repeating logs or showing internal stage labels', async () => {
  f.setSetupPending();
  f.clearRuns();
  f.startRun(
    { id: 'preparing', kind: 'prepare', project: f.project(), projectId: f.project().id },
    [],
  );
  f.setActivity([
    {
      at: report.generatedAt,
      runId: 'preparing',
      kind: 'look',
      summary: 'Reading your goal to write the requirements.',
    },
  ]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const chat = await screen.findByRole('dialog', { name: 'Chat with Aiden' });
  const progress = within(chat).getByRole('region', { name: 'Checks in this chat' });
  act(() =>
    f.emit({ type: 'progress', runId: 'preparing', stage: 'understand', message: 'Understand...' }),
  );
  expect(within(progress).queryByText('Understand...')).toBeNull();
  expect(
    within(progress).getAllByText('Reading your goal to write the requirements.'),
  ).toHaveLength(1);
  act(() =>
    f.emit({
      type: 'progress',
      runId: 'preparing',
      message: 'Reviewing the sign-in requirements.',
    }),
  );
  expect(within(progress).getByText('Reviewing the sign-in requirements.')).toBeVisible();
  expect(within(progress).queryByText('Reading your goal to write the requirements.')).toBeNull();
  await userEvent.click(within(progress).getByRole('button', { name: 'Stop' }));
  expect(f.request).toHaveBeenCalledWith('cancel', { runId: 'preparing' });
});

test('a running check streams progress and partial results in chat without losing the draft', async () => {
  const original = f.request.getMockImplementation()!;
  let questions: ReturnType<typeof openCall>[] = [];
  f.request.mockImplementation(async (method, params) => {
    const result = await original(method, params);
    return method === 'guide' ? { ...(result as GuideView), clarifications: questions } : result;
  });
  f.setSetupPending();
  f.clearRuns();
  f.startRun(
    { id: 'live-check', kind: 'verify', project: f.project(), projectId: f.project().id },
    [],
  );
  f.guideMessages().push({
    at: '2026-10-17T10:00:00.000Z',
    from: 'aiden',
    text: 'Ready to check.',
    widgets: [{ type: 'run-check' }],
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const chat = await screen.findByRole('dialog', { name: 'Chat with Aiden' });
  expect(
    await within(chat).findByRole('status', { name: 'Project work in progress' }),
  ).toHaveTextContent('Checking your app');
  expect(within(chat).queryByRole('button', { name: 'Later' })).toBeNull();
  expect(within(chat).queryByRole('button', { name: 'View progress' })).toBeNull();
  await userEvent.type(within(chat).getByLabelText('Message the Guide'), 'Keep my question');
  const summary = { total: 1, verified: 1, failed: 0, unverified: 0, line: '1 check passed.' };
  f.setVerification({
    reportPath: '/synthetic/report.html',
    result: {
      schemaVersion: '1.0',
      runId: 'live-check',
      projectId: f.project().id,
      projectName: 'Synthetic books',
      baselineId: report.baselineId,
      partial: true,
      url: 'http://localhost:3000',
      generatedAt: report.generatedAt,
      runtime: { provider: 'codex', auth: 'subscription', model: null, version: 'synthetic' },
      summary,
      criteria: [
        {
          requirementId: 'REQ-1',
          criterion: 'Books appear after signing in.',
          verdict: 'pass',
          reason: null,
          explanation: 'The signed-in list contains two books.',
          expected: null,
          observed: null,
          decisiveAttempt: null,
          attempts: [],
        },
      ],
    },
  });
  act(() =>
    f.emit({
      type: 'progress',
      runId: 'live-check',
      projectId: f.project().id,
      message: 'Checking whether a new book is saved.',
      verification: summary,
    }),
  );
  expect(await within(chat).findByText('Checking whether a new book is saved.')).toBeVisible();
  expect(await within(chat).findByText('1 check finished so far.')).toBeVisible();
  await userEvent.click(within(chat).getByText(/Books appear after signing in/));
  expect(within(chat).getByText('The signed-in list contains two books.')).toBeVisible();
  expect(chat).toBeVisible();
  expect(within(chat).getByLabelText('Message the Guide')).toHaveValue('Keep my question');
  expect(f.api.openVerificationReport).not.toHaveBeenCalled();
  await userEvent.click(within(chat).getByRole('button', { name: 'Back' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Show progress' }));
  questions = [openCall()];
  await f.request('cancel', { runId: 'live-check' });
  act(() => f.emit({ type: 'cancelled', runId: 'live-check', projectId: f.project().id }));
  expect(await within(chat).findByText(/Checking your app stopped/)).toBeVisible();
  expect(within(chat).getByRole('region', { name: 'App check results' })).toBeVisible();
  expect(within(chat).getByLabelText('Message the Guide')).toHaveValue('Keep my question');
  expect(await within(chat).findByText('Can two books share a title?')).toBeVisible();
  f.request.mockImplementation(original);
  expect(within(chat).queryByText(/Progress and results appear below/)).toBeNull();
  await userEvent.click(within(chat).getByRole('button', { name: 'Block duplicates' }));
  await userEvent.click(within(chat).getByRole('button', { name: 'Submit' }));
  expect(f.request).toHaveBeenCalledWith('askGuide', {
    projectId: f.project().id,
    clarification: { callId: 'call-1', answer: 'Block duplicates' },
  });
});

test('saved web and API cards render one setup form and a completed project can run again', async () => {
  f.guideMessages().push({
    at: '2026-10-17T10:00:00.000Z',
    from: 'aiden',
    text: 'Reconnect or check again.',
    widgets: [{ type: 'web-check' }, { type: 'api-check' }, { type: 'run-check' }],
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ask Aiden' }));
  const chat = await screen.findByRole('dialog', { name: 'Chat with Aiden' });
  expect(
    within(chat).getAllByRole('group', { name: 'How should Aiden check the work?' }),
  ).toHaveLength(1);
  expect(within(chat).getByRole('button', { name: 'Run the check now' })).toBeEnabled();
  expect(within(chat).queryByRole('button', { name: 'Later' })).toBeNull();
});

test('unanswered questions replace stale setup cards and return to requirement review after answers', async () => {
  const original = f.request.getMockImplementation()!;
  let questions = [
    openCall(),
    openCall({
      id: 'call-2',
      question: 'Who can edit a book?',
      options: ['Owners', 'Invited editors'],
      selectionMode: 'multiple',
    }),
  ];
  let pending = false;
  f.request.mockImplementation(async (method, params) => {
    if (method === 'askGuide' && params?.clarification) {
      questions = questions.filter((q) => q.id !== params.clarification.callId);
      pending = questions.length === 0;
    }
    const result = await original(method, params);
    if (method === 'guide' || method === 'askGuide')
      return { ...(result as GuideView), clarifications: questions, requirementsPending: pending };
    return result;
  });
  await openFreshProject();
  const chat = await screen.findByRole('dialog', { name: 'Chat with Aiden' });
  const first = await within(chat).findByRole('region', { name: 'Clarify your goal' });
  expect(within(first).getByText('Can two books share a title?')).toBeVisible();
  expect(within(chat).queryByRole('button', { name: 'Looks right' })).toBeNull();
  const composer = within(chat).getByLabelText('Message the Guide');
  await userEvent.type(composer, 'Keep this draft');
  const submit = within(first).getByRole('button', { name: 'Submit' });
  expect(submit).toBeDisabled();
  await userEvent.click(within(first).getByRole('button', { name: 'Allow duplicates' }));
  await userEvent.click(within(first).getByRole('button', { name: 'Block duplicates' }));
  expect(within(first).getByRole('button', { name: 'Allow duplicates' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(within(first).getByRole('button', { name: 'Block duplicates' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    f.request.mock.calls.some(([method, p]) => method === 'askGuide' && p?.clarification),
  ).toBe(false);
  expect(composer).toHaveValue('Keep this draft');
  await userEvent.click(submit);
  const second = await within(chat).findByText('Who can edit a book?');
  expect(second).toBeVisible();
  expect(f.request).toHaveBeenCalledWith('askGuide', {
    projectId: f.project().id,
    clarification: { callId: 'call-1', answer: 'Block duplicates' },
  });
  await userEvent.click(within(chat).getByRole('button', { name: 'Back' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ask Aiden' }));
  expect(within(chat).getByText('Who can edit a book?')).toBeVisible();
  expect(within(chat).getByRole('button', { name: 'Submit' })).toBeDisabled();
  expect(within(chat).getByText('Choose all that apply.')).toBeVisible();
  await userEvent.click(within(chat).getByRole('button', { name: 'Owners' }));
  await userEvent.click(within(chat).getByRole('button', { name: 'Invited editors' }));
  await userEvent.click(within(chat).getByRole('button', { name: 'Owners' }));
  expect(within(chat).getByRole('button', { name: 'Owners' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(within(chat).getByRole('button', { name: 'Invited editors' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await userEvent.click(within(chat).getByRole('button', { name: 'Owners' }));
  expect(composer).toHaveValue('Keep this draft');
  await userEvent.click(within(chat).getByRole('button', { name: 'Submit' }));
  expect(f.request).toHaveBeenCalledWith('askGuide', {
    projectId: f.project().id,
    clarification: { callId: 'call-2', answer: 'Owners\nInvited editors' },
  });
  expect(await within(chat).findByRole('button', { name: 'Update requirements' })).toBeVisible();
  expect(within(chat).queryByRole('button', { name: 'Looks right' })).toBeNull();
  pending = false;
  await userEvent.click(within(chat).getByRole('button', { name: 'Update requirements' }));
  expect(await within(chat).findByRole('button', { name: 'Looks right' })).toBeVisible();
  expect(f.request.mock.calls.some(([method]) => method === 'look')).toBe(false);
});
