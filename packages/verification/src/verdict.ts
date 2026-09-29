import type {
  CriterionOutcome,
  CriterionResult,
  PageCheck,
  UnverifiedReason,
  Verdict,
  VerificationAttempt,
  VerificationSummary,
  VisionJudgment,
} from '../../contracts/src/index.js';

/** Plain-language labels for every "Couldn't verify" reason shown in reports and the CLI. */
export const reasonLabels: Record<UnverifiedReason, string> = {
  not_testable_in_ui: "Couldn't verify: not testable in the UI.",
  blocked: "Couldn't verify: the app blocked the check.",
  destructive: "Couldn't verify: it needs a destructive or irreversible action.",
  needs_credentials: "Couldn't verify: it needs test credentials.",
  other: "Couldn't verify.",
  step_limit: "Couldn't verify: step limit reached.",
  signals_disagree: "Couldn't verify: signals disagree.",
  inconsistent_results: "Couldn't verify: inconsistent results.",
  no_evidence: "Couldn't verify: no evidence was recorded.",
};

/** Everything one attempt produced; vision is null when no cited check qualified for review. */
export interface AttemptEvidence {
  outcome: CriterionOutcome | null;
  stepLimitReached: boolean;
  checks: readonly PageCheck[];
  vision: VisionJudgment | null;
}

/** Aiden's decision for one attempt, before the single retry is considered. */
export interface AttemptJudgment {
  verdict: Verdict;
  reason: UnverifiedReason | null;
  explanation: string;
  proof: PageCheck | null;
}

/** Return the cited check only when it exists and agrees with the claimed pass or fail. */
export function reviewableProof(
  outcome: CriterionOutcome | null,
  checks: readonly PageCheck[],
): PageCheck | null {
  if (!outcome || outcome.outcome === 'unverified' || outcome.proofCheck === null) return null;
  const proof = checks.find((check) => check.id === outcome.proofCheck);
  if (!proof || proof.passed !== (outcome.outcome === 'pass')) return null;
  return proof;
}

/** Build an unverified judgment with Aiden's own explanation. */
function unverified(
  reason: UnverifiedReason,
  explanation: string,
  proof: PageCheck | null = null,
): AttemptJudgment {
  return { verdict: 'unverified', reason, explanation, proof };
}

/** Apply evidence rules: a pass needs a passing page check and a satisfied screenshot review. */
export function judgeAttempt(evidence: AttemptEvidence): AttemptJudgment {
  const { outcome, checks, vision } = evidence;
  if (evidence.stepLimitReached)
    return unverified('step_limit', 'Aiden ran out of steps before it could reach a verdict.');
  if (!outcome) return unverified('other', 'The browser agent did not return a usable answer.');
  if (outcome.outcome === 'unverified')
    return unverified(outcome.unverifiedReason ?? 'other', outcome.explanation);
  const claim = outcome.outcome === 'pass' ? 'passed' : 'failed';
  const cited = checks.find((check) => check.id === outcome.proofCheck) ?? null;
  if (!cited)
    return unverified(
      'no_evidence',
      `The browser agent said the criterion ${claim} but did not cite a page check Aiden recorded.`,
    );
  if (cited.passed !== (outcome.outcome === 'pass'))
    return unverified(
      'signals_disagree',
      `The browser agent said the criterion ${claim}, but Aiden's page check found: ${cited.actual}`,
      cited,
    );
  if (!vision)
    return unverified('other', 'The screenshot review did not return a usable answer.', cited);
  const agrees =
    outcome.outcome === 'pass' ? vision.judgment === 'satisfied' : vision.judgment !== 'satisfied';
  if (!agrees)
    return unverified(
      'signals_disagree',
      `The page check ${claim}, but the screenshot review found: ${vision.observation}`,
      cited,
    );
  return { verdict: outcome.outcome, reason: null, explanation: outcome.explanation, proof: cited };
}

/** Every non-pass gets exactly one fresh retry, as the verification rules require. */
export function shouldRetry(first: AttemptJudgment): boolean {
  return first.verdict !== 'pass';
}

/** Describe an attempt's verdict in a few words for the inconsistency explanation. */
function said(attempt: VerificationAttempt): string {
  if (attempt.verdict === 'pass') return 'passed';
  if (attempt.verdict === 'fail') return 'failed';
  const detail = reasonLabels[attempt.reason ?? 'other'].split(': ')[1]?.replace(/\.$/, '');
  return detail ? `could not verify it (${detail})` : 'could not verify it';
}

/** Combine one or two attempts; disagreeing runs never produce a pass or fail. */
export function criterionResult(
  requirementId: string,
  criterion: string,
  attempts: VerificationAttempt[],
): CriterionResult {
  const [first, second] = attempts;
  if (!first) throw new Error('A criterion needs at least one attempt.');
  if (second && second.verdict !== first.verdict)
    return {
      requirementId,
      criterion,
      verdict: 'unverified',
      reason: 'inconsistent_results',
      explanation: `The first run ${said(first)} and the second run ${said(second)}, so Aiden cannot give a reliable verdict.`,
      expected: null,
      observed: null,
      decisiveAttempt: null,
      attempts,
    };
  const decisive = first;
  return {
    requirementId,
    criterion,
    verdict: decisive.verdict,
    reason: decisive.reason,
    explanation: decisive.explanation,
    expected: decisive.expected,
    observed: decisive.observed,
    decisiveAttempt: decisive.attempt,
    attempts,
  };
}

/** Count verdicts and format the one-line project summary. */
export function summarize(criteria: readonly CriterionResult[]): VerificationSummary {
  const total = criteria.length;
  const verified = criteria.filter((c) => c.verdict === 'pass').length;
  const failed = criteria.filter((c) => c.verdict === 'fail').length;
  const unverifiedCount = total - verified - failed;
  return {
    total,
    verified,
    failed,
    unverified: unverifiedCount,
    line: `${verified} of ${total} criteria verified. ${failed} failed. ${unverifiedCount} couldn't be verified.`,
  };
}
