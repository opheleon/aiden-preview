import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { requirementState } from '../../apps/desktop/src/renderer/requirement-status';
import type { CriterionResult, VerificationAttempt } from '../../packages/contracts/src/index';
import { appFixture } from './app-fixture';
import { report } from './fixtures';
const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
let blobs = 0;
const revoke = vi.fn();
beforeEach(() => {
  f.reset();
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

function saveCheck(baselineId = report.baselineId) {
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
      criteria: [listed, created],
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

async function openProject() {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  return screen.findByRole('region', { name: 'Requirement status' });
}

function row(status: HTMLElement, id: string): HTMLElement {
  const article = within(status).getByText(id).closest('article');
  if (!article) throw new Error(`No row for ${id}`);
  return article;
}

test('code status leads until a browser check tests the same requirements', async () => {
  const status = await openProject();
  const summary = within(status).getByRole('region', { name: 'Status summary' });
  expect(summary).toHaveTextContent('0 of 2');
  expect(summary).toHaveTextContent('1 partially implemented, 1 not implemented');
  expect(summary).toHaveTextContent('Not checked');
  expect(summary).toHaveTextContent('Set an App URL to test each requirement in a browser.');
  expect(within(row(status, 'REQ-1')).getByText('Partially implemented')).toBeVisible();
  expect(within(row(status, 'REQ-1')).getByText('Deviated')).toBeVisible();
  expect(within(row(status, 'REQ-2')).getByText('Not implemented')).toBeVisible();
  expect(row(status, 'REQ-2')).toHaveTextContent('Browser · Not checked yet');
  expect(within(status).queryByRole('button', { name: /Watch recording/ })).toBeNull();
  const estimates = screen.getByText('Estimates', { selector: 'summary' }).closest('details');
  expect(estimates).not.toHaveAttribute('open');
});

test('a browser pass verifies a requirement and a backend-only one keeps its code status', async () => {
  saveCheck();
  const status = await openProject();
  const summary = within(status).getByRole('region', { name: 'Status summary' });
  expect(summary).toHaveTextContent('1 of 2');
  expect(summary).toHaveTextContent("0 failing, 1 couldn't be checked in the UI");
  expect(within(summary).getByRole('progressbar', { name: 'Verified in browser' })).toHaveValue(1);
  const first = row(status, 'REQ-1');
  expect(within(first).getByText('Verified in browser')).toHaveClass(
    'project-status-badge--verified',
  );
  expect(first).toHaveTextContent('Code · Partially implemented');
  expect(first).toHaveTextContent('Browser · Passed');
  const second = row(status, 'REQ-2');
  expect(within(second).getByText('Not implemented')).toBeVisible();
  expect(second).toHaveTextContent("Browser · Couldn't verify: not testable in the UI.");
  expect(within(second).queryByRole('button', { name: /Watch recording/ })).toBeNull();
});

test('a check of earlier requirements is never attached to the current ones', async () => {
  saveCheck('earlier-baseline');
  const status = await openProject();
  expect(within(status).getByRole('region', { name: 'Status summary' })).toHaveTextContent(
    'The last browser check used earlier requirements. Refresh status to check again.',
  );
  expect(within(row(status, 'REQ-1')).getByText('Partially implemented')).toBeVisible();
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

test("a browser verdict with evidence outranks the code reading; couldn't verify does not", () => {
  const failing = { ...listed, verdict: 'fail' as const, decisiveAttempt: 1 };
  expect(requirementState('implemented', failing)).toMatchObject({
    label: 'Fails in browser',
    tone: 'incomplete',
    code: 'Implemented',
    browser: 'Failed',
  });
  expect(requirementState('missing', listed)).toMatchObject({
    label: 'Verified in browser',
    tone: 'verified',
  });
  expect(requirementState('implemented', created)).toMatchObject({
    label: 'Implemented in code',
    tone: 'implemented',
    browser: "Couldn't verify: not testable in the UI.",
  });
  expect(requirementState(undefined, undefined)).toMatchObject({
    label: 'Not assessed',
    browser: 'Not checked yet',
  });
});
