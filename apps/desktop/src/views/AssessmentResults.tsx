import { ArrowUpRight, ChevronRight, FileText } from 'lucide-react';
import React from 'react';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../../packages/contracts/src/api.js';
import type { Project, Report } from '../../../../packages/contracts/src/index';

interface AssessmentResultsProps {
  report: Report;
  action: (fn: () => Promise<void>) => Promise<void>;
  setEvidence: React.Dispatch<React.SetStateAction<WorkerResult<'evidence'> | undefined>>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  project: Project;
}

/** Display requirement verdicts and links to inspected evidence. */
export function AssessmentResults(props: AssessmentResultsProps): React.JSX.Element {
  const { report, action, setEvidence, call, project } = props;
  return (
    <section className="card requirements-report legacy-report-panel">
      <div className="card-heading">
        <h2>Requirements</h2>
        <span className="count">{report.assessments.length} reviewed</span>
      </div>
      <p className="snapshot-note">
        Statuses describe the inspected code snapshots. Expand a requirement to review its evidence.
      </p>
      <div className="requirement-columns" aria-hidden="true">
        <span>Requirement</span>
        <span>Status in code</span>
      </div>
      <div className="requirement-rows">
        {report.assessments.map((a, i) => (
          <details className="assessment" key={a.requirementId} open={i === 0}>
            <summary>
              <ChevronRight className="assessment-chevron" size={15} aria-hidden="true" />
              <strong>
                <span className="req-id">{a.requirementId}</span>
                {report.baseline.requirements.find((r) => r.id === a.requirementId)?.text}
              </strong>
              <span className="assessment-status">
                <span className={`status ${a.status}`}>{a.status}</span>
                {a.deviation && <span className="status deviation">deviation</span>}
              </span>
            </summary>
            <div className="assessment-body">
              <p>{a.explanation}</p>
              {a.remainingWork.length > 0 && (
                <>
                  <h4>Remaining work</h4>
                  <ul>
                    {a.remainingWork.map((w, j) => (
                      <li key={j}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
              {a.unknowns.length > 0 && (
                <>
                  <h4>Unknowns</h4>
                  <ul>
                    {a.unknowns.map((w, j) => (
                      <li key={j}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="evidence-links">
                {a.evidence.map((e, j) => (
                  <button
                    key={j}
                    onClick={() =>
                      void action(async () =>
                        setEvidence(
                          await call('evidence', {
                            projectId: project.id,
                            runId: report.id,
                            index: i,
                            evidenceIndex: j,
                          }),
                        ),
                      )
                    }
                  >
                    <FileText size={13} />
                    {e.repositoryId} · {e.path}:{e.startLine} <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
