import { type JSX, useState } from 'react';

import type {
  CriterionResult,
  Report,
  VerificationAttempt,
  VerificationResult,
} from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import { browserLabel, plural } from '../renderer/requirement-status';
import { AttemptEvidence } from './BrowserEvidence';

/** Partial results describe completed checks without implying the whole run has finished. */
function checkSummary(result: VerificationResult): string {
  if (result.partial) return `${plural(result.criteria.length, 'check')} finished so far.`;
  return result.summary.total
    ? result.summary.line
    : 'No requirements were checked. Review the questions in this chat before trying again.';
}

/** Load the selected recording only after the person expands its inline evidence. */
function InlineEvidence({
  attempt,
  criterion,
  projectId,
  runId,
}: {
  attempt: VerificationAttempt;
  criterion: CriterionResult;
  projectId: string;
  runId: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="guide-check-evidence"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        Evidence{criterion.attempts.length > 1 ? ` from attempt ${attempt.attempt}` : ''}
      </summary>
      {expanded && (
        <AttemptEvidence
          api={window.aiden}
          projectId={projectId}
          runId={runId}
          attempt={attempt}
          method={criterion.method ?? 'app'}
        />
      )}
    </details>
  );
}

/** Expand a check in place; recordings load only when its evidence is opened. */
function CheckResult({
  criterion,
  projectId,
  runId,
}: {
  criterion: CriterionResult;
  projectId: string;
  runId: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="guide-check-result"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <b>{browserLabel(criterion)}</b> · {criterion.criterion}
      </summary>
      <p>{criterion.explanation}</p>
      {expanded &&
        criterion.attempts.map((attempt) => (
          <InlineEvidence
            key={attempt.attempt}
            attempt={attempt}
            criterion={criterion}
            projectId={projectId}
            runId={runId}
          />
        ))}
    </details>
  );
}

/** Plain labels for code assessment statuses. */
const codeLabels = {
  implemented: 'Implemented',
  partial: 'Partly implemented',
  missing: 'Not implemented',
  unknown: 'Could not determine',
};

/** One app check's results with expandable evidence, as it arrives or once it has finished. */
export function AppResults({
  result,
  projectId,
}: {
  result: VerificationResult;
  projectId: string;
}): JSX.Element {
  return (
    <section aria-label="App check results" className="guide-check-results">
      <p>{checkSummary(result)}</p>
      {result.criteria.map((criterion) => (
        <CheckResult
          key={`${result.runId}:${criterion.method}:${criterion.requirementId}:${criterion.edgeCaseId ?? ''}`}
          criterion={criterion}
          projectId={projectId}
          runId={result.runId}
        />
      ))}
    </section>
  );
}

/** One code check's conclusions, each requirement expandable to its explanation. */
export function CodeResults({ report }: { report: Report }): JSX.Element {
  return (
    <section aria-label="Code check results" className="guide-check-results">
      <p>{report.summary}</p>
      {report.assessments.map((assessment) => (
        <details key={`${report.id}:${assessment.requirementId}`} className="guide-check-result">
          <summary>
            <b>{codeLabels[assessment.status]}</b> ·{' '}
            {report.baseline.requirements.find((r) => r.id === assessment.requirementId)?.text ??
              assessment.requirementId}
          </summary>
          <p>{assessment.explanation}</p>
          {assessment.remainingWork.length > 0 && (
            <ul>
              {assessment.remainingWork.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {assessment.unknowns.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </details>
      ))}
    </section>
  );
}

/** The current-scope app results, unless another app check is running. */
function liveApp(workspace: Workspace, activeIds: string[]): VerificationResult | undefined {
  const result = workspace.verification?.result;
  if (result?.baselineId !== workspace.baseline?.id) return undefined;
  if (result?.projectId !== workspace.project.id) return undefined;
  const checkingApp = workspace.runs.some(
    (run) => activeIds.includes(run.id) && run.kind === 'verify',
  );
  return !checkingApp || activeIds.includes(result.runId) ? result : undefined;
}

/** The current-scope code conclusions, unless another code check is running. */
function liveCode(workspace: Workspace, activeIds: string[]): Report | undefined {
  const report = workspace.report;
  if (report?.baselineId !== workspace.baseline?.id) return undefined;
  if (report?.projectId !== workspace.project.id) return undefined;
  const checkingCode = workspace.runs.some(
    (run) => activeIds.includes(run.id) && run.kind === 'report',
  );
  return checkingCode ? undefined : report;
}

/**
 * Show current-scope app results as they arrive and code conclusions without leaving the chat.
 * Results already saved in the thread are shown there instead, so nothing appears twice.
 */
export function GuideCheckResults({
  workspace,
  activeIds,
  saved,
}: {
  workspace: Workspace;
  activeIds: string[];
  /** Run IDs whose results the thread already holds. */
  saved: ReadonlySet<string>;
}): JSX.Element {
  const app = liveApp(workspace, activeIds);
  const code = liveCode(workspace, activeIds);
  return (
    <>
      {app && !saved.has(app.runId) && <AppResults result={app} projectId={workspace.project.id} />}
      {code && !saved.has(code.id) && <CodeResults report={code} />}
    </>
  );
}
