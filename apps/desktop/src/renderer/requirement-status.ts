import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type {
  Call,
  CriterionResult,
  Report,
  TriageItem,
} from '../../../../packages/contracts/src/index';
import { blockerSources } from '../../../../packages/reporting/src/blockers';
import { remoteDeliveryVerified } from '../../../../packages/reporting/src/delivery-source';
import { reasonLabels } from '../../../../packages/verification/src/verdict';

type CodeStatus = Report['assessments'][number]['status'];
/** The latest browser check with its report path. */
export type Check = NonNullable<WorkerResult<'verification'>>;
/** Colour family a status chip uses. */
export type Tone = 'verified' | 'manual' | 'implemented' | 'partial' | 'incomplete' | 'neutral';

/** One status chip plus the sentence that says how Aiden knows. */
export interface ItemState {
  label: string;
  tone: Tone;
  how: string;
}

/** Everything the brief knows about one requirement. */
export interface RequirementFacts {
  code: CodeStatus | undefined;
  /** False when the report has only local or legacy evidence of branch membership. */
  remoteVerified?: boolean;
  /** Browser result for the requirement's main path. */
  main: CriterionResult | undefined;
  /** Browser results for the requirement's edge cases. */
  edges: CriterionResult[];
  /** How Aiden planned to check the main path. */
  method: TriageItem['method'] | undefined;
  /** Open decisions that leave this requirement's own behavior undefined. */
  openCalls: number;
  /** Open decisions on a prerequisite feature; this requirement is defined but its delivery waits. */
  waitingCalls?: number;
  /** Includes scoped edge cases that have not produced a result yet. */
  expectedEdges?: number;
  /** Manual confirmations are scoped to this exact accepted report. */
  manualConfirmed?: boolean;
  confirmedEdgeCount?: number;
}

/** A count with its noun, singular for one: `plural(1, 'call')` is "1 call". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** Describe a browser verdict in the same words the browser check report uses. */
export function browserLabel(result: CriterionResult | undefined): string {
  if (!result) return 'Not checked yet';
  if (result.verdict === 'pass') return 'Passed';
  if (result.verdict === 'fail') return 'Failed';
  return result.reason ? reasonLabels[result.reason] : "Couldn't verify.";
}

/** Why a browser check could not decide, in the words the full report uses. */
function unverifiedReason(result: CriterionResult | undefined): string {
  if (result?.verdict === 'unverified' && result.explanation) return result.explanation;
  return result?.reason ? reasonLabels[result.reason] : 'Not checked in your app yet.';
}

/** Status from the code assessment alone, used when the app gave no verdict. */
function codeState(facts: RequirementFacts): ItemState {
  if (facts.code === 'implemented' && facts.remoteVerified === false) return mergeUnverified();
  if (facts.code === 'implemented')
    return {
      label: facts.method === 'code' && !facts.expectedEdges ? 'Done' : 'Built',
      tone: 'implemented',
      how:
        facts.method === 'code'
          ? 'Built in the code. It is not visible in the app, so Aiden checked the code.'
          : `Built in the code. ${unverifiedReason(facts.main)}`,
    };
  if (facts.code === 'partial')
    return { label: 'In progress', tone: 'partial', how: 'Part of it is in the code.' };
  if (facts.code === 'missing')
    return { label: 'Not started', tone: 'incomplete', how: 'Aiden found no code for it yet.' };
  return { label: 'Unverified', tone: 'neutral', how: unverifiedReason(facts.main) };
}

/**
 * Pick the one status a requirement shows: Done, In progress, Not started, Failing, Blocked,
 * Waiting (on a prerequisite's decision), Needs manual test, or Unverified. What Aiden saw in the
 * app outranks the code reading, because it is what a user gets. Examples: the main path fails in the app is "Failing"; it passes but an
 * edge case fails is "In progress"; no app verdict and built in the code is "Built" unless the planned check is code-only.
 */
export function requirementState(facts: RequirementFacts): ItemState {
  if (facts.openCalls)
    return {
      label: 'Blocked',
      tone: 'partial',
      how: `Waiting on ${plural(facts.openCalls, 'decision')}. This requirement and dependent work are paused.`,
    };
  if (facts.waitingCalls)
    return {
      label: 'Waiting',
      tone: 'partial',
      how: `A prerequisite feature is waiting on ${plural(facts.waitingCalls, 'decision')}. This requirement is agreed, and its delivery starts once that is decided.`,
    };
  if (facts.main?.verdict === 'fail')
    return {
      label: 'Failing',
      tone: 'incomplete',
      how:
        facts.main.method === 'api'
          ? 'Failed via the API. Watch what happened.'
          : 'Failed in your app. Watch what happened.',
    };

  if (facts.main?.verdict === 'pass' || facts.manualConfirmed)
    return facts.remoteVerified === false ? mergeUnverified() : checkedState(facts);
  if (facts.method === 'person')
    return {
      label: 'Needs manual test',
      tone: 'neutral',
      how: 'This needs evidence from a manual or integration test. See the action items.',
    };
  return codeState(facts);
}

/** Status for one edge case: Pass, Fail, or Unverified, from its browser result or its plan. */
export function edgeState(
  result: CriterionResult | undefined,
  method: TriageItem['method'] | undefined,
): ItemState {
  if (result?.verdict === 'pass')
    return {
      label: 'Pass',
      tone: 'verified',
      how: result.method === 'api' ? 'Checked via the API.' : 'Checked in your app.',
    };
  if (result?.verdict === 'fail')
    return {
      label: 'Fail',
      tone: 'incomplete',
      how: result.method === 'api' ? 'Failed via the API.' : 'Failed in your app.',
    };
  if (method === 'code')
    return { label: 'Unverified', tone: 'neutral', how: 'Checked only in the code.' };
  if (method === 'person')
    return { label: 'Unverified', tone: 'neutral', how: 'Needs a manual test.' };
  return { label: 'Unverified', tone: 'neutral', how: unverifiedReason(result) };
}

/**
 * Return the browser check only when it tested the same requirements as the report; a check of
 * an older baseline would attach verdicts to requirements that have since changed.
 */
export function matchingCheck(
  verification: WorkerResult<'verification'>,
  report: Report,
  notBefore = report.generatedAt,
): Check | null {
  return verification &&
    verification.result.baselineId === report.baselineId &&
    verification.result.generatedAt >= notBefore
    ? verification
    : null;
}

/** Collect the facts for every requirement in the report. */
export function requirementFacts(
  report: Report,
  check: Check | null,
  calls: Call[],
  confirmed: Record<string, string> = {},
): Map<string, RequirementFacts> {
  const criteria = check?.result.criteria ?? [];
  const triage = check?.result.triage ?? [];
  const blockers = blockerSources(report.baseline, calls);
  return new Map(
    report.baseline.requirements.map((r) => [
      r.id,
      {
        remoteVerified: remoteDeliveryVerified(report),
        code: report.assessments.find((a) => a.requirementId === r.id)?.status,
        main: criteria.find((c) => c.requirementId === r.id && !c.edgeCaseId),
        edges: criteria.filter((c) => c.requirementId === r.id && !!c.edgeCaseId),
        expectedEdges: r.edgeCases?.length ?? 0,
        manualConfirmed: confirmed[r.id] === report.id,
        confirmedEdgeCount: (r.edgeCases ?? []).filter(
          (edge) =>
            confirmed[`${r.id}-${edge.id}`] === report.id &&
            !criteria.some(
              (c) => c.requirementId === r.id && c.edgeCaseId === edge.id && c.verdict === 'pass',
            ),
        ).length,
        method: triage.find((t) => t.requirementId === r.id && !t.edgeCaseId)?.method,
        openCalls: blockers.get(r.id)?.direct.length ?? 0,
        waitingCalls: blockers.get(r.id)?.inherited.length ?? 0,
      },
    ]),
  );
}

/**
 * The status line: how many requirements are done, and how many action items are open by role.
 * Example: "1 of 2 requirements done." with "3 action items: 1 PM, 2 Dev."
 */
export function briefStatus(
  states: ItemState[],
  actions: { pm: number; dev: number },
): { headline: string; lands: string } {
  const done = states.filter((s) => s.label === 'Done').length;
  const open = actions.pm + actions.dev;
  return {
    headline: `${done} of ${states.length} requirements done.`,
    lands: open
      ? `${plural(open, 'action item')}: ${actions.pm} PM, ${actions.dev} Dev.`
      : done === states.length
        ? 'All requirements done.'
        : 'No action items right now.',
  };
}

/** Completion needs every scoped edge case to pass or have a current manual confirmation. */
function checkedState(facts: RequirementFacts): ItemState {
  const location = evidenceLocation(facts);
  const failing = facts.edges.filter((e) => e.verdict === 'fail').length;
  const passing =
    facts.edges.filter((e) => e.verdict === 'pass').length + (facts.confirmedEdgeCount ?? 0);
  if (failing)
    return {
      label: 'In progress',
      tone: 'partial',
      how: `Passes ${location}, but ${plural(failing, 'edge case')} ${failing === 1 ? 'fails' : 'fail'}.`,
    };
  if (passing < Math.max(facts.expectedEdges ?? 0, facts.edges.length))
    return {
      label: 'Needs verification',
      tone: 'neutral',
      how: 'The main path passes; some edge cases still need verification.',
    };
  return {
    label: 'Done',
    tone: facts.manualConfirmed ? 'manual' : 'verified',
    how: facts.manualConfirmed
      ? 'Confirmed by you for this check.'
      : facts.edges.length
        ? `Checked ${location}, with ${passing} of ${facts.edges.length} edge cases.`
        : `Checked ${location}.`,
  };
}

/** Describe API and browser evidence accurately, including requirements with mixed checks. */
function evidenceLocation(facts: RequirementFacts): string {
  const checks = [facts.main, ...facts.edges].filter((c) => c?.verdict === 'pass');
  if (!checks.some((c) => c?.method === 'api')) return 'in your app';
  return checks.every((c) => c?.method === 'api') ? 'via the API' : 'with recorded checks';
}

/** Passing local checks cannot establish that the work is on the remote delivery branch. */
function mergeUnverified(): ItemState {
  return {
    label: 'Branch unverified',
    tone: 'neutral',
    how: 'Monitored remote-branch presence is unverified. Local code and checks do not establish delivery.',
  };
}
