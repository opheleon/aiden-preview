import { type JSX, useState } from 'react';

import type {
  CriterionResult,
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

/** Show current-scope app results as they arrive and code conclusions without leaving the chat. */
export function GuideCheckResults({
  workspace,
  activeIds,
}: {
  workspace: Workspace;
  activeIds: string[];
}): JSX.Element {
  const result = workspace.verification?.result;
  const current =
    result?.baselineId === workspace.baseline?.id && result?.projectId === workspace.project.id;
  const checkingApp = workspace.runs.some(
    (run) => activeIds.includes(run.id) && run.kind === 'verify',
  );
  const showApp = result && current && (!checkingApp || activeIds.includes(result.runId));
  const report = workspace.report;
  const showCode =
    report &&
    report.baselineId === workspace.baseline?.id &&
    report.projectId === workspace.project.id &&
    !workspace.runs.some((run) => activeIds.includes(run.id) && run.kind === 'report');
  const labels = {
    implemented: 'Implemented',
    partial: 'Partly implemented',
    missing: 'Not implemented',
    unknown: 'Could not determine',
  };
  return (
    <>
      {showApp && (
        <section aria-label="App check results" className="guide-check-results">
          <p>{checkSummary(result)}</p>
          {result.criteria.map((criterion) => (
            <CheckResult
              key={`${result.runId}:${criterion.method}:${criterion.requirementId}:${criterion.edgeCaseId ?? ''}`}
              criterion={criterion}
              projectId={workspace.project.id}
              runId={result.runId}
            />
          ))}
        </section>
      )}
      {showCode && (
        <section aria-label="Code check results" className="guide-check-results">
          <p>{report.summary}</p>
          {report.assessments.map((assessment) => (
            <details
              key={`${report.id}:${assessment.requirementId}`}
              className="guide-check-result"
            >
              <summary>
                <b>{labels[assessment.status]}</b> ·{' '}
                {report.baseline.requirements.find((r) => r.id === assessment.requirementId)
                  ?.text ?? assessment.requirementId}
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
      )}
    </>
  );
}
