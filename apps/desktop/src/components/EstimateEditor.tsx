import type { JSX } from 'react';

import type { RequirementEstimate } from '../../../../packages/contracts/src/index';
import { durationText, sizes } from '../renderer/estimate-format';
import type { EstimateEditing, RequirementEstimatesProps } from './estimate-types';
/** Review model reasoning and explicitly save or reset a size or duration override. */
export function EstimateEditor({
  editing,
  row,
  report,
  busy,
  saveSize,
  saveDuration,
  days,
  setDays,
  estimation,
  onConfigureHistory,
  onOpenExternal,
  setEditing,
}: Pick<
  RequirementEstimatesProps,
  'report' | 'busy' | 'estimation' | 'onConfigureHistory' | 'onOpenExternal'
> & {
  editing: EstimateEditing;
  row: RequirementEstimate;
  saveSize: (id: string, points: number | null) => Promise<void>;
  saveDuration: (id: string, days: number | null) => Promise<void>;
  days: string;
  setDays: (value: string) => void;
  setEditing: (value: EstimateEditing | null) => void;
}): JSX.Element {
  return (
    <div className="modal-overlay">
      <section
        className="product-workspace estimate-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editing.kind === 'size' ? 'Complexity' : 'Estimated duration'}
      >
        <header>
          <h2>{editing.kind === 'size' ? 'Complexity' : 'Estimated duration'}</h2>
          <p>
            {row.requirementId} ·{' '}
            {report.baseline.requirements.find((value) => value.id === row.requirementId)?.text}
          </p>
        </header>
        {editing.kind === 'size' ? (
          <>
            <p className="estimate-reason">{row.original.reasoning}</p>
            <div className="estimate-size-options" role="group" aria-label="Choose complexity">
              {sizes.map((size) => (
                <button
                  key={size.points}
                  disabled={busy}
                  aria-pressed={row.points === size.points}
                  onClick={() => void saveSize(row.requirementId, size.points)}
                >
                  {size.label}
                </button>
              ))}
            </div>
            <p className="product-muted">
              Original scope size assumes an existing live service. Remaining work is estimated
              separately from the saved code assessment.
            </p>
            {row.pointsOverridden && (
              <button
                className="text-button"
                onClick={() => void saveSize(row.requirementId, null)}
              >
                Reset size to suggested
              </button>
            )}
          </>
        ) : (
          <>
            <p className="estimate-reason">{row.original.reasoning}</p>
            {row.suggestedDurationDays === null && (
              <div className="estimate-connect-panel">
                <p>Connect your task manager to estimate from your team’s completed work.</p>
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing(null);
                    onConfigureHistory();
                  }}
                >
                  Configure history
                </button>
              </div>
            )}
            {row.comparisons.length >= 3 && (
              <p className="product-muted">
                Historical duration uses {row.comparisons.length} comparable completed issues. This
                describes observed variation, not a delivery guarantee.
              </p>
            )}
            <form
              className="estimate-duration-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDuration(row.requirementId, Number(days));
              }}
            >
              <label className="estimate-days-input">
                Duration (days)
                <input
                  aria-label={`Duration in days ${row.requirementId}`}
                  type="number"
                  min="0.1"
                  max="3650"
                  step="0.1"
                  required
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              </label>
              <p className="product-muted">
                How long the work should take, including reviews and waiting.
              </p>
              <div className="product-actions">
                <button className="primary" disabled={busy}>
                  Save duration
                </button>
                {row.durationOverridden && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void saveDuration(row.requirementId, null)}
                  >
                    Reset duration to predicted
                  </button>
                )}
              </div>
            </form>
            {row.comparisons.length > 0 && (
              <ComparisonLinks row={row} estimation={estimation} onOpenExternal={onOpenExternal} />
            )}
          </>
        )}
        <button className="secondary estimate-close" onClick={() => setEditing(null)}>
          Close
        </button>
      </section>
    </div>
  );
}

/** Show the saved historical examples behind a duration estimate without implying a guarantee. */
function ComparisonLinks({
  row,
  estimation,
  onOpenExternal,
}: Pick<RequirementEstimatesProps, 'estimation' | 'onOpenExternal'> & {
  row: RequirementEstimate;
}): JSX.Element {
  return (
    <details className="estimate-comparisons">
      <summary>{row.comparisons.length} similar completed issues</summary>
      <ul>
        {row.comparisons.map((id) => {
          const comparison = estimation.history.find((item) => item.id === id);
          return comparison ? (
            <li key={id}>
              <button onClick={() => comparison.url && onOpenExternal(comparison.url)}>
                {comparison.identifier} · {comparison.title}
              </button>{' '}
              · {durationText(comparison.observedCalendarDays)}
            </li>
          ) : null;
        })}
      </ul>
    </details>
  );
}
