import { AlertTriangle, GitCommitHorizontal } from 'lucide-react';
import type { JSX } from 'react';

import type { Report } from '../../../../packages/contracts/src/index';

/** Explain inspected snapshots, scope deviations, risks, and validation limitations. */
export function ReportDetails({ report }: { report: Report }): JSX.Element {
  return (
    <>
      <section className="card summary legacy-report-panel">
        <div className="health-heading">
          <h2>Project health</h2>
          <span>Based on code assessment</span>
        </div>
        <div className="metrics">
          {(['implemented', 'partial', 'missing', 'unknown'] as const).map((s) => (
            <div key={s}>
              <strong>{report.assessments.filter((a) => a.status === s).length}</strong>
              <span>
                <i className={s} />
                {s}
              </span>
            </div>
          ))}
        </div>
        <p className="health-insight">{report.summary}</p>
      </section>
      <div className="snapshot-list legacy-report-panel" aria-label="Assessed code snapshots">
        {report.snapshots.map((snapshot) => (
          <span key={`${snapshot.repositoryId}-${snapshot.sha}`} title={snapshot.reason}>
            <GitCommitHorizontal size={14} />
            {snapshot.repositoryId}
            <span className="snapshot-branch">{snapshot.branch}</span>
            <code>{snapshot.sha.slice(0, 8)}</code>
          </span>
        ))}
      </div>
      <div className="project-secondary-heading">
        <h2>Project activity</h2>
      </div>
      <section className="product-card deviations-card">
        <h3>Deviation findings</h3>
        {report.deviations.length ? (
          <ul>
            {report.deviations.map((d) => (
              <li key={d.requirementId}>
                <strong>{d.requirementId}</strong>: {d.explanation}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No contradictory behavior established.</p>
        )}
      </section>
      <div className="report-grid project-activity-grid">
        {[
          ['Risks', report.risks],
          ['Dependencies', report.dependencies],
          ['Unknowns', report.unknowns],
          ['Milestones', report.baseline.milestones],
        ].map(([title, items]) => (
          <section className="product-card" key={title as string}>
            <h3>{title as string}</h3>
            {(items as string[]).length ? (
              <ul>
                {(items as string[]).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None reported.</p>
            )}
          </section>
        ))}
      </div>
      {report.warnings.length > 0 && (
        <section className="product-card limitations">
          <h3>
            <AlertTriangle size={16} /> Coverage & freshness
          </h3>
          <ul>
            {[...new Set(report.warnings)].map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="fine-print">
        Structural validation checks the report and its evidence references. It does not
        independently prove the agent’s conclusions. These findings describe committed code, not
        verified deployment.
      </p>
    </>
  );
}
