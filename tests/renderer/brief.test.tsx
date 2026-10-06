import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { risks } from '../../apps/desktop/src/renderer/action-items';
import {
  briefStatus,
  edgeState,
  requirementState,
} from '../../apps/desktop/src/renderer/requirement-status';
import type {
  CodingJob,
  CriterionResult,
  VerificationAttempt,
} from '../../packages/contracts/src/index';
import { appFixture, openCall } from './app-fixture';
import { report } from './fixtures';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
let blobs = 0;
const revoke = vi.fn();
beforeEach(() => {
  f.reset();
  f.api.verificationMedia.mockResolvedValue({ type: 'video/webm', data: new ArrayBuffer(8) });
  blobs = 0;
  revoke.mockClear();
  // jsdom has no blob URLs; the pop-up only needs distinct strings to hand to <video> and <img>.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:synthetic-${++blobs}`),
    revokeObjectURL: revoke,
  });
});

// Synthetic browser check results written for these tests, not recorded agent output.
function attempt(n: number, verdict: VerificationAttempt['verdict']): VerificationAttempt {
  return {
    attempt: n,
    verdict,
    reason: null,
    explanation: `Synthetic attempt ${n} explanation`,
    expected: 'A list of books',
    observed: verdict === 'pass' ? 'Two books were listed' : null,
    video: `REQ-1/attempt-${n}/video.webm`,
    proof:
      verdict === 'pass'
        ? {
            id: 1,
            step: 2,
            role: 'heading',
            name: 'Books',
            state: 'visible',
            text: null,
            passed: true,
            actual: 'Heading "Books" is visible',
            atMs: 4200,
            screenshot: `REQ-1/attempt-${n}/proof-1.png`,
          }
        : null,
    vision: null,
    steps: [
      {
        index: 1,
        action: 'Open the books page',
        reasoning: 'Synthetic reasoning',
        result: 'The books page loaded',
        url: 'http://localhost:5173/books',
        atMs: 1500,
        screenshot: null,
      },
    ],
  };
}

const listed: CriterionResult = {
  requirementId: 'REQ-1',
  criterion: 'Users can list books.',
  verdict: 'pass',
  reason: null,
  explanation: 'Synthetic pass explanation',
  expected: 'A list of books',
  observed: 'Two books were listed',
  decisiveAttempt: 2,
  attempts: [attempt(1, 'fail'), attempt(2, 'pass')],
};

const created: CriterionResult = {
  requirementId: 'REQ-2',
  criterion: 'Users can create books.',
  verdict: 'unverified',
  reason: 'not_testable_in_ui',
  explanation: 'Synthetic backend-only explanation',
  expected: null,
  observed: null,
  decisiveAttempt: null,
  attempts: [],
};

function saveCheck(baselineId = report.baselineId, criteria = [listed, created]) {
  f.setVerification({
    result: {
      schemaVersion: '1.0',
      runId: 'verify-run',
      projectId: report.projectId,
      projectName: 'Synthetic books',
      baselineId,
      url: 'http://localhost:5173/',
      generatedAt: report.generatedAt,
      runtime: { provider: 'codex', auth: 'subscription', model: null, version: 'synthetic' },
      criteria,
      summary: {
        total: 2,
        verified: 1,
        failed: 0,
        unverified: 1,
        line: "1 of 2 criteria verified. 0 failed. 1 couldn't be verified.",
      },
    },
    reportPath: '/synthetic/verification/report.html',
  });
}

/** Synthetic result for REQ-1's first edge case. */
const emptyLibrary: CriterionResult = {
  ...listed,
  edgeCaseId: 'E1',
  persona: 'a first-time user',
  criterion: 'An empty library says there are no books yet.',
  verdict: 'fail',
  explanation: 'Synthetic edge case failure',
  expected: 'A message saying there are no books yet',
  observed: 'A blank page',
  decisiveAttempt: 1,
  attempts: [attempt(1, 'fail')],
};

/** A report whose REQ-1 carries two edge cases. */
function withEdgeCases() {
  const product = {
    ...report.baseline,
    requirements: report.baseline.requirements.map((r) =>
      r.id === 'REQ-1'
        ? {
            ...r,
            edgeCases: [
              {
                id: 'E1',
                text: 'An empty library says there are no books yet.',
                origin: 'scope' as const,
              },
              {
                id: 'E2',
                text: 'Book titles longer than the column wrap.',
                origin: 'found' as const,
              },
            ],
          }
        : r,
    ),
  };
  f.setReport({ ...report, baseline: product });
}

async function openProject() {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  return screen.findByRole('region', { name: 'Requirements' });
}

/** A requirement's row, found by its ID. */
function row(status: HTMLElement, id: string): HTMLElement {
  const details = within(status).getByText(id, { selector: 'summary code' }).closest('details');
  if (!details) throw new Error(`No row for ${id}`);
  return details;
}

test('the brief leads with status, action items by role, and one status per requirement', async () => {
  const status = await openProject();
  expect(screen.getByText('0 of 2 requirements complete')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  expect(within(row(status, 'REQ-1')).getByText('In progress')).toBeVisible();
  expect(within(row(status, 'REQ-2')).getByText('Not started')).toBeVisible();
  await userEvent.click(within(row(status, 'REQ-1')).getByText('Users can list books.'));
  await userEvent.click(
    within(row(status, 'REQ-2')).getByText('Users can create books.', {
      selector: 'summary .row-title',
    }),
  );
  expect(
    within(row(status, 'REQ-1')).getByRole('region', { name: 'Action items' }),
  ).toHaveTextContent('Finish: Users can list books.');
  expect(
    within(row(status, 'REQ-2')).getByRole('region', { name: 'Action items' }),
  ).toHaveTextContent('Build: Users can create books.');
  expect(screen.queryByRole('region', { name: 'Risks' })).toBeNull();
});

test('app failures produce work items while blocking decisions suppress dependent verification actions', async () => {
  withEdgeCases();
  saveCheck(report.baselineId, [listed, created, emptyLibrary]);
  f.setCalls([openCall()]);
  const status = await openProject();
  const first = row(status, 'REQ-1');
  expect(within(first).getByText('In progress')).toBeVisible();
  await userEvent.click(within(first).getByText('Users can list books.'));
  expect(within(first).getByText('Fail')).toBeVisible();
  expect(within(first).getByText(/As a first-time user/)).toBeVisible();
  expect(within(first).getByText('Found by Aiden')).toBeVisible();
  expect(within(row(status, 'REQ-2')).getByText('Blocked')).toBeVisible();
  expect(screen.getByText('0 of 2 requirements complete')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Needs you' })).toHaveTextContent(
    'Decide: Can two books share a title?',
  );
  await userEvent.click(
    within(row(status, 'REQ-2')).getByText('Users can create books.', {
      selector: 'summary .row-title',
    }),
  );
  const actions = within(first).getByRole('region', { name: 'Action items' });
  expect(actions).toHaveTextContent('Fix: An empty library says there are no books yet.');
  expect(actions).toHaveTextContent('Now: A blank page');
  expect(within(row(status, 'REQ-2')).queryByRole('region', { name: 'Action items' })).toBeNull();
  expect(within(row(status, 'REQ-2')).getByText(/dependent work are paused/)).toBeVisible();
  await userEvent.click(within(actions).getByRole('button', { name: 'Watch recording REQ-1-E1' }));
  expect(await screen.findByRole('dialog', { name: 'Browser check' })).toHaveTextContent(
    'REQ-1 edge case E1 · Browser check',
  );
});

test('a check of earlier requirements is never attached to the current ones', async () => {
  saveCheck('earlier-baseline');
  const status = await openProject();
  expect(within(row(status, 'REQ-1')).getByText('In progress')).toBeVisible();
  expect(within(status).queryByRole('button', { name: /Watch recording/ })).toBeNull();
});

test('the recording pop-up plays the deciding attempt and can switch to the retry', async () => {
  saveCheck();
  const status = await openProject();
  await userEvent.click(within(status).getByRole('button', { name: 'Watch recording REQ-1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Browser check' });
  expect(dialog).toHaveTextContent('REQ-1 · Browser check');
  expect(within(dialog).getByRole('heading', { name: 'Users can list books.' })).toBeVisible();
  const attempts = within(dialog).getByRole('group', { name: 'Attempts' });
  expect(
    within(attempts).getByRole('button', { name: 'Attempt 2 · Passed (decided the result)' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const video = await within(dialog).findByLabelText('Recording of attempt 2');
  expect(video).toHaveAttribute('src', expect.stringMatching(/^blob:synthetic-/));
  expect(f.api.verificationMedia).toHaveBeenCalledWith({
    projectId: report.projectId,
    runId: 'verify-run',
    file: 'REQ-1/attempt-2/video.webm',
  });
  expect(f.api.verificationMedia).toHaveBeenCalledWith({
    projectId: report.projectId,
    runId: 'verify-run',
    file: 'REQ-1/attempt-2/proof-1.png',
  });
  expect(
    await within(dialog).findByRole('img', {
      name: 'Page check screenshot: Heading "Books" is visible',
    }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent('Page check passed: Heading "Books" is visible');
  expect(dialog).toHaveTextContent('Two books were listed');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Jump to step 1 at 0:01' }));
  expect((video as HTMLVideoElement).currentTime).toBe(1.5);
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Jump to the page check at 0:04' }),
  );
  expect((video as HTMLVideoElement).currentTime).toBe(4.2);

  await userEvent.click(within(attempts).getByRole('button', { name: 'Attempt 1 · Failed' }));
  expect(await within(dialog).findByLabelText('Recording of attempt 1')).toBeVisible();
  expect(dialog).toHaveTextContent('Not recorded');
  expect(within(dialog).queryByRole('img')).toBeNull();
  await waitFor(() => expect(revoke).toHaveBeenCalled());

  await userEvent.click(within(dialog).getByRole('button', { name: 'Open full report' }));
  expect(f.api.openVerificationReport).toHaveBeenCalledWith({
    projectId: report.projectId,
    runId: 'verify-run',
  });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Browser check' })).toBeNull();
  await userEvent.click(within(status).getByRole('button', { name: 'Watch recording REQ-1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Browser check' })).toBeNull();
});

test('a recording that cannot be loaded says so instead of showing an empty player', async () => {
  saveCheck();
  f.api.verificationMedia.mockRejectedValue(new Error('missing'));
  const status = await openProject();
  await userEvent.click(within(status).getByRole('button', { name: 'Watch recording REQ-1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Browser check' });
  expect(await within(dialog).findAllByText('This file could not be loaded.')).toHaveLength(2);
  expect(within(dialog).queryByLabelText(/Recording of attempt/)).toBeNull();
});

test('statuses follow what Aiden saw, then open decisions, then the code', () => {
  const base = {
    code: 'implemented' as const,
    main: undefined,
    edges: [],
    method: undefined,
    openCalls: 0,
  };
  expect(requirementState({ ...base, main: { ...listed, verdict: 'fail' } })).toMatchObject({
    label: 'Failing',
    tone: 'incomplete',
  });
  expect(
    requirementState({ ...base, main: listed, edges: [{ ...listed, edgeCaseId: 'E1' }] }),
  ).toMatchObject({
    label: 'Done',
    tone: 'verified',
    how: 'Checked in your app, with 1 of 1 edge cases.',
  });
  expect(
    requirementState({ ...base, main: listed, edges: [emptyLibrary, emptyLibrary] }),
  ).toMatchObject({
    label: 'In progress',
    how: 'Passes in your app, but 2 edge cases fail.',
  });
  expect(requirementState({ ...base, code: 'missing', openCalls: 2 })).toMatchObject({
    label: 'Blocked',
    how: expect.stringMatching(/2 decisions/),
  });
  expect(requirementState({ ...base, code: 'missing', method: 'person' }).label).toBe(
    'Needs manual test',
  );
  expect(requirementState({ ...base, method: 'code' }).how).toMatch(/checked the code/);
  expect(requirementState({ ...base, main: created }).how).toBe(
    'Built in the code. Synthetic backend-only explanation',
  );
  expect(requirementState({ ...base, code: 'partial' }).label).toBe('In progress');
  expect(requirementState({ ...base, code: undefined }).label).toBe('Unverified');
  expect(edgeState(listed, 'app').label).toBe('Pass');
  expect(edgeState(emptyLibrary, 'app').label).toBe('Fail');
  expect(edgeState(undefined, 'code')).toMatchObject({
    label: 'Unverified',
    how: 'Checked only in the code.',
  });
  expect(edgeState(undefined, 'person')).toMatchObject({
    label: 'Unverified',
    how: 'Needs a manual test.',
  });
  expect(edgeState(created, 'app').how).toBe('Synthetic backend-only explanation');
  expect(briefStatus([{ label: 'Done', tone: 'verified', how: '' }], { pm: 0, dev: 0 })).toEqual({
    headline: '1 of 1 requirements done.',
    lands: 'All requirements done.',
  });
  expect(
    briefStatus([{ label: 'Failing', tone: 'incomplete', how: '' }], { pm: 1, dev: 1 }),
  ).toEqual({
    headline: '0 of 1 requirements done.',
    lands: '2 action items: 1 PM, 1 Dev.',
  });
  expect(
    briefStatus([{ label: 'Unverified', tone: 'neutral', how: '' }], { pm: 0, dev: 0 }).lands,
  ).toBe('No action items right now.');
  expect(risks(report, null)).toEqual([]);
});

test('API evidence opens in Watch and an inconclusive check can be confirmed manually', async () => {
  saveCheck(report.baselineId, [
    { ...listed, method: 'api' },
    { ...created, method: 'api' },
  ]);
  const status = await openProject();
  const first = row(status, 'REQ-1');
  expect(first).toHaveTextContent('Checked via the API.');
  await userEvent.click(within(first).getByRole('button', { name: 'Watch recording REQ-1' }));
  const dialog = await screen.findByRole('dialog', { name: 'API check' });
  expect(await within(dialog).findByRole('img', { name: /API check screenshot/ })).toBeVisible();
  expect(dialog).toHaveTextContent('API check passed');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  const second = row(status, 'REQ-2');
  await userEvent.click(
    within(second).getByText('Users can create books.', { selector: 'summary .row-title' }),
  );
  const actions = within(second).getByRole('region', { name: 'Action items' });
  expect(actions).toHaveTextContent('Test by hand:');
  await userEvent.click(within(actions).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(second).toHaveTextContent('Confirmed by you for this check.'));
  expect(
    requirementState({
      code: 'implemented',
      main: { ...listed, method: 'api', verdict: 'fail' },
      edges: [],
      method: 'api',
      openCalls: 0,
      manualConfirmed: true,
    }).label,
  ).toBe('Failing');
});

test('coding events update delivery automatically without completing requirements or starting a check', async () => {
  const original = f.api.request.getMockImplementation()!;
  let unavailable = false;
  let saved = false;
  const job: CodingJob = {
    id: 'synthetic-job',
    repositoryId: 'repo',
    repository: 'fixture/repo',
    worktree: '/fixture/job',
    branch: 'aiden/job',
    baseBranch: 'main',
    projectId: report.projectId,
    baselineId: report.baselineId,
    status: 'awaiting_merge',
    message: 'Review not recorded. Waiting for merge.',
    createdAt: report.generatedAt,
    updatedAt: report.generatedAt,
    runtime: { provider: 'claude', auth: 'subscription' },
    checks: [],
    pullRequestUrl: 'https://github.com/fixture/repo/pull/1',
  };
  f.api.request.mockImplementation((method, params) => {
    if (method === 'codingJobs')
      return unavailable
        ? Promise.reject(new Error('Synthetic offline GitHub'))
        : Promise.resolve(saved ? [job] : []);
    return original(method, params);
  });
  try {
    await openProject();
    const status = screen.getByRole('region', { name: 'Status' });
    expect(status).not.toHaveTextContent('Coding finished');
    saved = true;
    act(() => f.emit({ type: 'coding', projectId: report.projectId, runId: job.id }));
    await waitFor(() => expect(status).toHaveTextContent('Coding finished. PR open'));
    expect(screen.getByRole('region', { name: 'Requirements' })).not.toHaveTextContent(
      'Coding finished',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByRole('region', { name: 'Activity' })).toHaveTextContent('Coding finished');
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(within(status).getByRole('link', { name: 'Open pull request' })).toHaveAttribute(
      'href',
      job.pullRequestUrl,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(
      f.api.request.mock.calls.some(([method]) =>
        ['look', 'startCoding', 'verify', 'reconcileDelivery'].includes(method),
      ),
    ).toBe(false);
    unavailable = true;
    act(() => f.emit({ type: 'coding', projectId: report.projectId, runId: job.id }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read coding jobs');
    expect(status).toHaveTextContent('Coding finished');
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run check now' })).toBeEnabled();
  } finally {
    f.api.request.mockImplementation(original);
  }
});
