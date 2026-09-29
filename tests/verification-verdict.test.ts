import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CriterionOutcome,
  PageCheck,
  VerificationAttempt,
  VerificationResult,
} from '../packages/contracts/src/index.js';
import {
  criterionResult,
  judgeAttempt,
  plainText,
  reasonLabels,
  renderReport,
  reviewableProof,
  shouldRetry,
  summarize,
} from '../packages/verification/src/index.js';

const check = (id: number, passed: boolean): PageCheck => ({
  id,
  step: id,
  role: 'button',
  name: 'Save',
  state: 'disabled',
  text: null,
  passed,
  actual: passed ? 'The button "Save" is disabled.' : 'The button "Save" is enabled.',
  atMs: 4200,
  screenshot: `proof-${id}.png`,
});
const outcome = (value: Partial<CriterionOutcome>): CriterionOutcome => ({
  outcome: 'pass',
  unverifiedReason: null,
  explanation: 'Save is disabled when the name is empty.',
  expected: null,
  observed: null,
  proofCheck: 1,
  ...value,
});
const satisfied = { judgment: 'satisfied', observation: 'Save looks greyed out.' } as const;
const notSatisfied = { judgment: 'not_satisfied', observation: 'Save looks enabled.' } as const;
const attempt = (value: Partial<VerificationAttempt>): VerificationAttempt => ({
  attempt: 1,
  verdict: 'pass',
  reason: null,
  explanation: 'Worked.',
  expected: null,
  observed: null,
  video: 'REQ-1/attempt-1/video.webm',
  proof: null,
  vision: null,
  steps: [],
  ...value,
});

void test('a pass needs a cited passing check and a satisfied screenshot review', () => {
  const checks = [check(1, true)];
  assert.equal(
    judgeAttempt({ outcome: outcome({}), stepLimitReached: false, checks, vision: satisfied })
      .verdict,
    'pass',
  );
  const disagree = judgeAttempt({
    outcome: outcome({}),
    stepLimitReached: false,
    checks,
    vision: notSatisfied,
  });
  assert.equal(disagree.reason, 'signals_disagree');
  assert.match(disagree.explanation, /screenshot review found: Save looks enabled/);
  assert.equal(
    judgeAttempt({ outcome: outcome({}), stepLimitReached: false, checks, vision: null }).reason,
    'other',
  );
  const noCitation = judgeAttempt({
    outcome: outcome({ proofCheck: null }),
    stepLimitReached: false,
    checks,
    vision: satisfied,
  });
  assert.equal(noCitation.reason, 'no_evidence');
  const failedCheck = judgeAttempt({
    outcome: outcome({}),
    stepLimitReached: false,
    checks: [check(1, false)],
    vision: satisfied,
  });
  assert.equal(failedCheck.reason, 'signals_disagree');
  assert.match(failedCheck.explanation, /page check found/);
});

void test('a fail needs a cited failing check that the screenshot does not contradict', () => {
  const failing = outcome({ outcome: 'fail', expected: 'Disabled', observed: 'Enabled' });
  const checks = [check(1, false)];
  assert.equal(
    judgeAttempt({ outcome: failing, stepLimitReached: false, checks, vision: notSatisfied })
      .verdict,
    'fail',
  );
  assert.equal(
    judgeAttempt({
      outcome: failing,
      stepLimitReached: false,
      checks,
      vision: { judgment: 'unclear', observation: 'Hard to tell.' },
    }).verdict,
    'fail',
  );
  assert.equal(
    judgeAttempt({ outcome: failing, stepLimitReached: false, checks, vision: satisfied }).reason,
    'signals_disagree',
  );
  assert.equal(
    judgeAttempt({
      outcome: failing,
      stepLimitReached: false,
      checks: [check(1, true)],
      vision: null,
    }).reason,
    'signals_disagree',
  );
});

void test('step limits, missing answers, and agent reasons are never passes', () => {
  const checks = [check(1, true)];
  assert.equal(
    judgeAttempt({ outcome: outcome({}), stepLimitReached: true, checks, vision: satisfied })
      .reason,
    'step_limit',
  );
  assert.equal(
    judgeAttempt({ outcome: null, stepLimitReached: false, checks, vision: null }).reason,
    'other',
  );
  const email = outcome({
    outcome: 'unverified',
    unverifiedReason: 'not_testable_in_ui',
    proofCheck: null,
  });
  assert.equal(
    judgeAttempt({ outcome: email, stepLimitReached: false, checks: [], vision: null }).reason,
    'not_testable_in_ui',
  );
  const unexplained = outcome({ outcome: 'unverified', unverifiedReason: null, proofCheck: null });
  assert.equal(
    judgeAttempt({ outcome: unexplained, stepLimitReached: false, checks: [], vision: null })
      .reason,
    'other',
  );
});

void test('only an existing, agreeing citation is sent for screenshot review', () => {
  const checks = [check(1, true), check(2, false)];
  assert.equal(reviewableProof(outcome({}), checks)?.id, 1);
  assert.equal(reviewableProof(outcome({ outcome: 'fail', proofCheck: 2 }), checks)?.id, 2);
  assert.equal(reviewableProof(outcome({ proofCheck: 2 }), checks), null);
  assert.equal(reviewableProof(outcome({ proofCheck: 9 }), checks), null);
  assert.equal(reviewableProof(outcome({ proofCheck: null }), checks), null);
  assert.equal(reviewableProof(outcome({ outcome: 'unverified' }), checks), null);
  assert.equal(reviewableProof(null, checks), null);
});

void test('non-passes retry once and disagreeing runs become inconsistent results', () => {
  assert.equal(shouldRetry({ verdict: 'pass', reason: null, explanation: '', proof: null }), false);
  assert.equal(shouldRetry({ verdict: 'fail', reason: null, explanation: '', proof: null }), true);
  assert.equal(
    shouldRetry({
      verdict: 'unverified',
      reason: 'not_testable_in_ui',
      explanation: '',
      proof: null,
    }),
    true,
  );
  const single = criterionResult('REQ-1', 'Criterion', [attempt({})]);
  assert.equal(single.verdict, 'pass');
  assert.equal(single.decisiveAttempt, 1);
  const same = criterionResult('REQ-2', 'Criterion', [
    attempt({ verdict: 'fail', expected: 'A', observed: 'B' }),
    attempt({ attempt: 2, verdict: 'fail' }),
  ]);
  assert.equal(same.verdict, 'fail');
  assert.equal(same.expected, 'A');
  const mixed = criterionResult('REQ-3', 'Criterion', [
    attempt({ verdict: 'fail' }),
    attempt({ attempt: 2, verdict: 'unverified', reason: 'step_limit' }),
  ]);
  assert.equal(mixed.reason, 'inconsistent_results');
  assert.match(
    mixed.explanation,
    /first run failed and the second run could not verify it \(step limit reached\)/,
  );
  const other = criterionResult('REQ-4', 'Criterion', [
    attempt({ verdict: 'unverified', reason: 'other' }),
    attempt({ attempt: 2, verdict: 'pass' }),
  ]);
  assert.match(other.explanation, /first run could not verify it and the second run passed/);
  assert.throws(() => criterionResult('REQ-5', 'Criterion', []), /at least one attempt/);
});

void test('summary line uses the fixed wording', () => {
  const results = [
    criterionResult('REQ-1', 'a', [attempt({})]),
    criterionResult('REQ-2', 'b', [attempt({ verdict: 'fail' })]),
    criterionResult('REQ-3', 'c', [attempt({ verdict: 'unverified', reason: 'blocked' })]),
  ];
  assert.equal(
    summarize(results).line,
    "1 of 3 criteria verified. 1 failed. 1 couldn't be verified.",
  );
  assert.equal(reasonLabels.not_testable_in_ui, "Couldn't verify: not testable in the UI.");
});

void test('reports escape page text, drop em dashes, and never label fixtures as live', () => {
  const proof = check(1, true);
  const criteria = [
    criterionResult('REQ-1', 'Save <b>works</b>', [
      attempt({
        proof,
        explanation: 'Saved — as expected.',
        steps: [
          {
            index: 1,
            action: 'Clicked button "Save"',
            reasoning: 'Try it',
            result: '<script>x</script>',
            url: 'http://localhost',
            atMs: 1200,
            screenshot: 'REQ-1/attempt-1/step-01.jpg',
          },
          {
            index: 2,
            action: 'Observed',
            reasoning: 'Look',
            result: 'Done.',
            url: 'http://localhost',
            atMs: 65000,
            screenshot: null,
          },
        ],
      }),
    ]),
    criterionResult('REQ-2', 'Save disabled', [
      attempt({
        verdict: 'fail',
        expected: 'Disabled',
        observed: 'Enabled',
        proof: check(2, false),
      }),
      attempt({ attempt: 2, verdict: 'fail', proof: check(2, false) }),
    ]),
    criterionResult('REQ-3', 'Email sent', [
      attempt({ verdict: 'unverified', reason: 'not_testable_in_ui' }),
    ]),
    criterionResult('REQ-4', 'Flaky', [
      attempt({ verdict: 'pass', proof }),
      attempt({ attempt: 2, verdict: 'unverified', reason: null }),
    ]),
  ];
  const result: VerificationResult = {
    schemaVersion: '1.0',
    runId: 'run',
    projectId: 'project',
    projectName: 'Demo & Co',
    baselineId: 'baseline',
    url: 'http://localhost:4173/',
    generatedAt: '2026-09-28T12:00:00.000Z',
    runtime: {
      provider: 'claude',
      auth: 'subscription',
      model: 'claude-sonnet-5',
      version: '2.1.0',
    },
    criteria,
    summary: summarize(criteria),
  };
  const html = renderReport(result);
  assert.match(html, /Save &lt;b&gt;works&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.equal(html.includes('—'), false);
  assert.match(html, /Saved, as expected\./);
  assert.match(html, /Checked live by Claude \(subscription\), model claude-sonnet-5/);
  assert.match(html, /video\.webm#t=4\.2/);
  assert.match(html, /Jump to proof at 0:04/);
  assert.match(html, />1:05</);
  assert.match(html, /What happened/);
  assert.match(html, /Checked twice in fresh browsers/);
  assert.match(html, /Couldn&#39;t verify: not testable in the UI\./);
  assert.match(html, /Couldn&#39;t verify: inconsistent results\./);
  assert.match(html, /1 of 4 criteria verified\. 1 failed\. 2 couldn&#39;t be verified\./);
  const fixtureHtml = renderReport({
    ...result,
    runtime: { provider: 'codex', auth: 'apiKey', model: null, version: 'fixture-only' },
  });
  assert.match(fixtureHtml, /test fixture, not a live agent/);
  assert.equal(fixtureHtml.includes('Checked live'), false);
  assert.match(
    renderReport({
      ...result,
      runtime: { provider: 'codex', auth: 'apiKey', model: null, version: '0.145.0' },
    }),
    /Codex \(API key\), model default/,
  );
  assert.equal(plainText('a — b'), 'a, b');
});
