import { type JSX, useState } from 'react';

import type { EstimateEditing, RequirementEstimatesProps } from './estimate-types';
import { EstimateEditor } from './EstimateEditor';
import { EstimateHistory, HistoryEditor } from './EstimateHistory';
import { EstimateRow } from './EstimateRow';
import ProjectHealth from './ProjectHealth';

/** Present accepted requirement estimates, supporting evidence, and explicit manual adjustments. */
export default function RequirementEstimates({
  estimation,
  report,
  overrides,
  busy,
  onSave,
  onReestimate,
  onConfigureHistory,
  onOpenExternal,
  onOpenEvidence,
}: RequirementEstimatesProps): JSX.Element {
  const [editing, setEditing] = useState<EstimateEditing | null>(null);
  const [historyEdit, setHistoryEdit] = useState<string | null>(null);
  const [days, setDays] = useState('');
  const [error, setError] = useState('');
  const row = editing
    ? estimation.requirements.find((item) => item.requirementId === editing.id)
    : null;
  const historyItem = historyEdit
    ? estimation.history.find((item) => item.id === historyEdit)
    : null;
  /** Persist or reset a requirement size before closing its editor. */
  const saveSize = async (id: string, points: number | null) => {
    const requirementPoints = { ...overrides.requirementPoints };
    if (points === null) delete requirementPoints[id];
    else requirementPoints[id] = points;
    if (await persistOverride(onSave, { ...overrides, requirementPoints }, setError))
      setEditing(null);
  };
  /** Persist or reset a duration override before closing its editor. */
  const saveDuration = async (id: string, duration: number | null) => {
    const durations = { ...overrides.durations };
    if (duration === null) delete durations[id];
    else durations[id] = duration;
    if (await persistOverride(onSave, { ...overrides, durations }, setError)) setEditing(null);
  };
  /** Persist or reset historical calibration points without modifying the external task manager. */
  const saveHistory = async (id: string, points: number | null) => {
    const historicalPoints = { ...overrides.historicalPoints };
    if (points === null) delete historicalPoints[id];
    else historicalPoints[id] = points;
    if (await persistOverride(onSave, { ...overrides, historicalPoints }, setError))
      setHistoryEdit(null);
  };
  return (
    <section className="requirement-estimates" aria-label="Requirement estimates">
      <ProjectHealth
        estimation={estimation}
        report={report}
        overrides={overrides}
        onSave={onSave}
        busy={busy}
      />
      <section className="project-overview" aria-label="Approved product intent">
        <h2>Overview</h2>
        <div className="product-markdown">
          <p>{report.baseline.overview}</p>
        </div>
      </section>
      <div className="estimate-heading">
        <div>
          <h2>Requirements & estimates</h2>
          <p>
            Original scope and historical duration are shown below. Project forecasts use remaining
            work from the latest code assessment.
          </p>
        </div>
        <button className="text-button" disabled={busy} onClick={() => void onReestimate()}>
          Re-estimate
        </button>
      </div>
      <AssessmentSummary report={report} />
      {error && <p role="alert">{error}</p>}
      <div className="estimate-column-headings" aria-hidden="true">
        <span>Requirement</span>
        <div>
          <span className="estimate-status">Status in code</span>
          <span className="estimate-size">Complexity</span>
          <span className="estimate-time">Duration</span>
        </div>
      </div>
      {estimation.requirements.map((item) => (
        <EstimateRow
          key={item.requirementId}
          item={item}
          report={report}
          busy={busy}
          setEditing={setEditing}
          setDays={setDays}
          onOpenEvidence={onOpenEvidence}
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
      <EstimateHistory
        estimation={estimation}
        overrides={overrides}
        onOpenExternal={onOpenExternal}
        onConfigureHistory={onConfigureHistory}
        setHistoryEdit={setHistoryEdit}
      />
      <details className="estimate-method">
        <summary>How estimates work</summary>
        <p className="estimate-footnote">
          Suggested duration is the median of at least 3 comparable issues in the saved 90-day
          history window, including manual history adjustments. Matches use size and known scope
          shape, preferring the same work type. Remaining work uses the published code assessment.
          Click a size or duration to review its reasoning and make changes.
        </p>
      </details>
      {estimation.historyTruncated && (
        <p className="estimate-footnote">History reached its configured collection limit.</p>
      )}
      {editing && row && (
        <EstimateEditor
          editing={editing}
          row={row}
          report={report}
          busy={busy}
          saveSize={saveSize}
          saveDuration={saveDuration}
          days={days}
          setDays={setDays}
          estimation={estimation}
          onConfigureHistory={onConfigureHistory}
          onOpenExternal={onOpenExternal}
          setEditing={setEditing}
        />
      )}
      {historyItem && (
        <HistoryEditor
          historyItem={historyItem}
          overrides={overrides}
          saveHistory={saveHistory}
          setHistoryEdit={setHistoryEdit}
        />
      )}
    </section>
  );
}

/** Keep assessment conclusions and incomplete evidence coverage visible beside estimates. */
function AssessmentSummary({ report }: Pick<RequirementEstimatesProps, 'report'>): JSX.Element {
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

/** Keep failed override writes visible and leave the editor open for correction or retry. */
async function persistOverride(
  save: RequirementEstimatesProps['onSave'],
  next: RequirementEstimatesProps['overrides'],
  setError: (message: string) => void,
): Promise<boolean> {
  setError('');
  try {
    await save(next);
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Could not save estimate changes.');
    return false;
  }
}
