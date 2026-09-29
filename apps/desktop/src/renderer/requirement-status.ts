import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { CriterionResult, Report } from '../../../../packages/contracts/src/index';
import { reasonLabels } from '../../../../packages/verification/src/verdict';

type CodeStatus = Report['assessments'][number]['status'];

/** One requirement's combined state: the headline badge plus what each source said. */
export interface RequirementState {
  label: string;
  tone: 'verified' | 'implemented' | 'partial' | 'incomplete' | 'neutral';
  code: string;
  browser: string;
}

const codeLabels: Record<CodeStatus, string> = {
  implemented: 'Implemented',
  partial: 'Partially implemented',
  missing: 'Not implemented',
  unknown: 'Not assessed',
};

const codeStates: Record<CodeStatus, Pick<RequirementState, 'label' | 'tone'>> = {
  implemented: { label: 'Implemented in code', tone: 'implemented' },
  partial: { label: 'Partially implemented', tone: 'partial' },
  missing: { label: 'Not implemented', tone: 'incomplete' },
  unknown: { label: 'Not assessed', tone: 'neutral' },
};

/** Describe a browser verdict in the same words the browser check report uses. */
export function browserLabel(result: CriterionResult | undefined): string {
  if (!result) return 'Not checked yet';
  if (result.verdict === 'pass') return 'Passed';
  if (result.verdict === 'fail') return 'Failed';
  return result.reason ? reasonLabels[result.reason] : "Couldn't verify.";
}

/**
 * Combine the code assessment with the browser check. A browser verdict with recorded evidence
 * outranks the code reading, because it shows what a user actually gets; "couldn't verify" leaves
 * the code status in charge. Examples: implemented + pass is "Verified in browser"; implemented +
 * fail is "Fails in browser"; implemented + not testable in the UI is "Implemented in code".
 */
export function requirementState(
  code: CodeStatus | undefined,
  browser: CriterionResult | undefined,
): RequirementState {
  const sources = { code: codeLabels[code ?? 'unknown'], browser: browserLabel(browser) };
  if (browser?.verdict === 'pass')
    return { label: 'Verified in browser', tone: 'verified', ...sources };
  if (browser?.verdict === 'fail')
    return { label: 'Fails in browser', tone: 'incomplete', ...sources };
  return { ...codeStates[code ?? 'unknown'], ...sources };
}

/**
 * Return the browser check only when it tested the same approved requirements as the report;
 * a check of an older baseline would attach verdicts to requirements that have since changed.
 */
export function matchingCheck(
  verification: WorkerResult<'verification'>,
  report: Report,
): NonNullable<WorkerResult<'verification'>> | null {
  return verification && verification.result.baselineId === report.baselineId ? verification : null;
}

/** Headline counts for the status summary, by code status and browser verdict. */
export interface StatusCounts {
  total: number;
  implemented: number;
  partial: number;
  missing: number;
  verified: number;
  failing: number;
  unchecked: number;
  deviations: number;
}

/** Count requirements by code status and browser verdict; browser counts are zero without a matching check. */
export function statusCounts(
  report: Report,
  check: NonNullable<WorkerResult<'verification'>> | null,
): StatusCounts {
  const criteria = check?.result.criteria ?? [];
  /** Count assessments with one code status. */
  const code = (status: CodeStatus) => report.assessments.filter((a) => a.status === status).length;
  return {
    total: report.baseline.requirements.length,
    implemented: code('implemented'),
    partial: code('partial'),
    missing: code('missing'),
    verified: criteria.filter((c) => c.verdict === 'pass').length,
    failing: criteria.filter((c) => c.verdict === 'fail').length,
    unchecked: criteria.filter((c) => c.verdict === 'unverified').length,
    deviations: report.assessments.filter((a) => a.deviation).length,
  };
}
