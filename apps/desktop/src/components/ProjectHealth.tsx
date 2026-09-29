import type { JSX } from 'react';

import type { EstimationSnapshot, Report } from '../../../../packages/contracts/src/index';

/** Show code-assessed progress without inventing a schedule from ticket durations or manual velocity. */
export default function ProjectHealth({
  estimation,
  report,
}: {
  estimation: EstimationSnapshot;
  report: Report;
}): JSX.Element {
  const health = estimation.forecast;
  return (
    <section className="project-health" aria-label="Project health">
      <div className="project-health-heading">
        <h2>Scope by complexity</h2>
        <span>From the code assessment and estimates</span>
      </div>
      <div className="project-health-metrics">
        <div className="project-health-metric">
          <h3>Scope implemented</h3>
          <strong>
            {health.implementedPercent === null ? 'Not assessed' : `${health.implementedPercent}%`}
          </strong>
          <p>
            {health.implementedPoints} of {health.totalPoints} original complexity points
          </p>
          {health.implementedPercent !== null && (
            <progress aria-label="Scope implemented" max="100" value={health.implementedPercent} />
          )}
        </div>
        <div className="project-health-metric">
          <h3>Remaining scope</h3>
          <strong>{health.remainingPoints ?? 'Unknown'}</strong>
          <p>Complexity points for remaining changes, including corrections</p>
        </div>
        <div className="project-health-metric">
          <h3>Scope deviations</h3>
          <strong>{report.deviations.length}</strong>
          <p>Requirements that differ from agreed scope</p>
        </div>
      </div>
      <p className="project-health-insight">
        Time ranges appear beside individual requirements when comparable ticket history is
        available. They are not added into a project finish date: work may overlap or depend on
        other changes.
      </p>
      <details className="project-health-method">
        <summary>About this assessment</summary>
        <p>
          Progress weights implemented requirements by their original scope sizes. Remaining scope
          is sized separately from code evidence. Code assessment does not confirm deployment or
          passing tests. Last assessed {new Date(report.generatedAt).toLocaleString()}.
        </p>
      </details>
    </section>
  );
}
