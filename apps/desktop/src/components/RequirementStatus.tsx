import { Play } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { CriterionResult, Report } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import { matchingCheck, requirementState, statusCounts } from '../renderer/requirement-status';
import { BrowserEvidence } from './BrowserEvidence';

type Assessment = Report['assessments'][number];
type Check = NonNullable<WorkerResult<'verification'>>;
type OpenEvidence = (assessmentIndex: number, evidenceIndex: number) => void;

/** The accepted report, the project's latest browser check, and how to open their evidence. */
export interface RequirementStatusProps {
  report: Report;
  verification: WorkerResult<'verification'>;
  projectId: string;
  api: DesktopBridge | undefined;
  onOpenEvidence: OpenEvidence;
}

/**
 * The primary project view: each approved requirement with what the code assessment found and,
 * when a browser check tested the same requirements, what Aiden saw using the app. Recordings open
 * in a pop-up. A check of older requirements is not attached, so a verdict never lands on a
 * requirement it did not test.
 */
export default function RequirementStatus({
  report,
  verification,
  projectId,
  api,
  onOpenEvidence,
}: RequirementStatusProps): JSX.Element {
  const check = matchingCheck(verification, report);
  const [watching, setWatching] = useState<CriterionResult | null>(null);
  return (
    <section className="requirement-estimates requirement-status" aria-label="Requirement status">
      <StatusSummary report={report} verification={verification} check={check} />
      <section className="project-overview" aria-label="Approved product intent">
        <h2>Overview</h2>
        <div className="product-markdown">
          <p>{report.baseline.overview}</p>
        </div>
      </section>
      <div className="estimate-heading">
        <div>
          <h2>Requirements</h2>
          <p>
            Implemented in code means the code assessment found it. Verified in browser means Aiden
            also used the app at your App URL and saw it work.
          </p>
        </div>
      </div>
      <AssessmentSummary report={report} />
      {report.baseline.requirements.map((requirement) => (
        <StatusRow
          key={requirement.id}
          requirement={requirement}
          report={report}
          browser={check?.result.criteria.find((c) => c.requirementId === requirement.id)}
          onOpenEvidence={onOpenEvidence}
          onWatch={setWatching}
        />
      ))}
      <details className="project-inspected-code">
        <summary>Inspected code · {report.snapshots.length} snapshots</summary>
        <ul>
          {report.snapshots.map((target) => (
            <li key={`${target.repositoryId}-${target.sha}`}>
              {target.repositoryId} · {target.branch} · <code>{target.sha.slice(0, 8)}</code>
              <p>{target.reason}</p>
            </li>
          ))}
        </ul>
      </details>
      {watching && check && (
        <BrowserEvidence
          api={api}
          projectId={projectId}
          runId={check.result.runId}
          criterion={watching}
          onClose={() => setWatching(null)}
        />
      )}
    </section>
  );
}

/** Headline counts: implemented in code, verified in a browser, and deviations from scope. */
function StatusSummary({
  report,
  verification,
  check,
}: {
  report: Report;
  verification: WorkerResult<'verification'>;
  check: Check | null;
}): JSX.Element {
  const counts = statusCounts(report, check);
  const assessed = new Date(report.generatedAt).toLocaleDateString();
  const checked = check && new Date(check.result.generatedAt).toLocaleDateString();
  const browserNote = check
    ? `${counts.failing} failing, ${counts.unchecked} couldn't be checked in the UI`
    : verification
      ? 'The last browser check used earlier requirements. Refresh status to check again.'
      : 'Set an App URL to test each requirement in a browser.';
  return (
    <section className="project-health" aria-label="Status summary">
      <div className="project-health-heading">
        <h2>Status</h2>
        <span>
          Code assessed {assessed}
          {checked ? `, browser checked ${checked}` : ''}
        </span>
      </div>
      <div className="project-health-metrics">
        <div className="project-health-metric">
          <h3>Implemented in code</h3>
          <strong>
            {counts.implemented} <small>of {counts.total}</small>
          </strong>
          <p>
            {counts.partial} partially implemented, {counts.missing} not implemented
          </p>
          <progress
            aria-label="Implemented in code"
            max={counts.total}
            value={counts.implemented}
          />
        </div>
        <div className="project-health-metric">
          <h3>Verified in browser</h3>
          <strong>
            {check ? (
              <>
                {counts.verified} <small>of {counts.total}</small>
              </>
            ) : (
              'Not checked'
            )}
          </strong>
          <p>{browserNote}</p>
          {check && (
            <progress aria-label="Verified in browser" max={counts.total} value={counts.verified} />
          )}
        </div>
        <div className="project-health-metric">
          <h3>Deviations</h3>
          <strong>{counts.deviations}</strong>
          <p>Requirements built differently from the agreed scope</p>
        </div>
      </div>
    </section>
  );
}

/** One requirement: combined badge, both sources, and expandable code, browser, and remaining work. */
function StatusRow({
  requirement,
  report,
  browser,
  onOpenEvidence,
  onWatch,
}: {
  requirement: Report['baseline']['requirements'][number];
  report: Report;
  browser: CriterionResult | undefined;
  onOpenEvidence: OpenEvidence;
  onWatch: (criterion: CriterionResult) => void;
}): JSX.Element {
  const assessmentIndex = report.assessments.findIndex((a) => a.requirementId === requirement.id);
  const assessment = report.assessments[assessmentIndex];
  const state = requirementState(assessment?.status, browser);
  return (
    <article className="estimate-row requirement-status-row">
      <div className="estimate-requirement">
        <span className="project-requirement-id">{requirement.id}</span>
        <p>{requirement.text}</p>
        <p className="requirement-sources">
          <span>Code · {state.code}</span>
          <span>Browser · {state.browser}</span>
          {browser && browser.attempts.length > 0 && (
            <button
              className="text-button requirement-watch"
              aria-label={`Watch recording ${requirement.id}`}
              onClick={() => onWatch(browser)}
            >
              <Play size={12} aria-hidden="true" /> Watch recording
            </button>
          )}
        </p>
      </div>
      <div className="estimate-status">
        <span className={`project-status-badge project-status-badge--${state.tone}`}>
          {state.label}
        </span>
        {assessment?.deviation && (
          <span className="project-status-badge project-status-badge--deviated">Deviated</span>
        )}
      </div>
      {assessment && (
        <AssessmentEvidence
          status={assessment}
          assessmentIndex={assessmentIndex}
          onOpenEvidence={onOpenEvidence}
        />
      )}
      {browser && (
        <details className="estimate-evidence">
          <summary>Browser check</summary>
          <p>{browser.explanation}</p>
          {browser.expected && <h3>Expected</h3>}
          {browser.expected && <p>{browser.expected}</p>}
          {browser.observed && <h3>Observed</h3>}
          {browser.observed && <p>{browser.observed}</p>}
        </details>
      )}
      {assessment && assessment.remainingWork.length > 0 && (
        <details className="estimate-evidence">
          <summary>Remaining work · {assessment.remainingWork.length}</summary>
          <ul>
            {assessment.remainingWork.map((work, index) => (
              <li key={index}>{work}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/** Link each implementation claim to its recorded source evidence and deviation explanation. */
function AssessmentEvidence({
  status,
  assessmentIndex,
  onOpenEvidence,
}: {
  status: Assessment;
  assessmentIndex: number;
  onOpenEvidence: OpenEvidence;
}): JSX.Element {
  return (
    <details className="estimate-evidence">
      <summary>Code evidence</summary>
      <h3>Implementation</h3>
      <p>{status.explanation}</p>
      {status.evidence.length > 0 && (
        <div className="estimate-evidence-links">
          {status.evidence.map((item, evidenceIndex) => (
            <button
              key={`${item.repositoryId}:${item.path}:${item.startLine}`}
              onClick={() => onOpenEvidence(assessmentIndex, evidenceIndex)}
            >
              {item.repositoryId} · {item.path}:{item.startLine}
            </button>
          ))}
        </div>
      )}
      <h3>Deviation · {status.deviation ? 'Yes' : 'No deviation found'}</h3>
      <p>
        {status.deviation
          ? status.explanation
          : 'No contradictory behavior was established in the inspected snapshots.'}
      </p>
    </details>
  );
}

/** Keep the assessment's own summary and any coverage limits one click away. */
function AssessmentSummary({ report }: { report: Report }): JSX.Element {
  return (
    <>
      <details className="estimate-assessment">
        <summary>
          Latest code assessment · {new Date(report.generatedAt).toLocaleDateString()}
        </summary>
        <div className="project-status-summary">
          <p>{report.summary}</p>
        </div>
      </details>
      {report.warnings.length > 0 && (
        <details className="project-coverage-warning">
          <summary>Coverage limitations</summary>
          <ul>
            {report.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
