import { type JSX, useState } from 'react';

import type { EstimateEditing, RequirementEstimatesProps } from './estimate-types';
import { EstimateEditor } from './EstimateEditor';
import { EstimateHistory, HistoryEditor } from './EstimateHistory';
import { EstimateRow } from './EstimateRow';
import ProjectHealth from './ProjectHealth';

/**
 * Present remaining work estimates: change size, history-based time, and manual adjustments.
 * Requirement status and code evidence live in RequirementStatus; this view is secondary.
 */
export default function RequirementEstimates({
  estimation,
  report,
  overrides,
  busy,
  onSave,
  onReestimate,
  onConfigureHistory,
  onOpenExternal,
}: RequirementEstimatesProps): JSX.Element {
  const [editing, setEditing] = useState<EstimateEditing | null>(null);
  const [historyEdit, setHistoryEdit] = useState<string | null>(null);
  const [error, setError] = useState('');
  const row = editing
    ? estimation.requirements.find((item) => item.requirementId === editing.id)
    : null;
  const historyItem = historyEdit
    ? estimation.history.find((item) => item.id === historyEdit)
    : null;
  /** Persist or reset a requirement size before closing its editor. */
  const saveSize = async (id: string, points: number | null) => {
    const remainingPoints = { ...overrides.remainingPoints };
    if (points === null) delete remainingPoints[id];
    else remainingPoints[id] = points;
    if (await persistOverride(onSave, { ...overrides, remainingPoints }, setError))
      setEditing(null);
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
      <ProjectHealth estimation={estimation} report={report} />
      <div className="estimate-heading">
        <div>
          <h2>Remaining work estimates</h2>
          <p>
            Size reflects the remaining change and its testing risk. Time comes only from similar
            completed tickets, with no delivery-rate setup.
          </p>
        </div>
        <button className="text-button" disabled={busy} onClick={() => void onReestimate()}>
          Re-estimate
        </button>
      </div>
      {estimation.estimatorVersion === '1' && (
        <p className="estimate-footnote">
          This saved estimate uses the earlier method. Re-estimate to match remaining changes with
          recent tickets. Previously entered durations are no longer used as time predictions.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="estimate-column-headings" aria-hidden="true">
        <span>Requirement</span>
        <div>
          <span className="estimate-size">Change size</span>
          <span className="estimate-time">Time range</span>
        </div>
      </div>
      {estimation.requirements.map((item) => (
        <EstimateRow
          key={item.requirementId}
          item={item}
          report={report}
          busy={busy}
          setEditing={setEditing}
          estimation={estimation}
        />
      ))}
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
          The LLM sizes touch points, testing difficulty, and change risk. We match the same size,
          work type, and scope shape in your selected source’s last 90 days. The LLM selects up to
          five analogous changes and explains each match. At least three tickets with start and
          completion dates are required. The range is their observed minimum to maximum, with the
          median shown in the explanation. It includes reviews and waiting, not just coding. Click a
          time range to see the tickets.
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
