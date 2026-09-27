import type { JSX } from 'react';

import type { HistoryIssue } from '../../../../packages/contracts/src/index';
import { durationText, sizes } from '../renderer/estimate-format';
import type { RequirementEstimatesProps } from './estimate-types';
/** Display calibration records and offer connection setup when no history has been collected. */
export function EstimateHistory({
  estimation,
  overrides,
  onOpenExternal,
  onConfigureHistory,
  setHistoryEdit,
}: Pick<
  RequirementEstimatesProps,
  'estimation' | 'overrides' | 'onOpenExternal' | 'onConfigureHistory'
> & { setHistoryEdit: (value: string | null) => void }): JSX.Element {
  return (
    <>
      {estimation.history.length > 0 ? (
        <details className="estimate-history">
          <summary>Team history · {estimation.history.length} completed issues</summary>
          <p className="product-muted">
            Click a comparison to adjust its size. Adjustments are marked * and survive
            re-estimation.
          </p>
          {estimation.history.map((item) => (
            <div className="estimate-history-row" key={item.id}>
              <div>
                <button
                  className="estimate-history-link"
                  onClick={() => item.url && onOpenExternal(item.url)}
                >
                  {item.identifier}
                </button>
                <p>{item.title}</p>
              </div>
              <button
                className="estimate-value"
                aria-label={`Edit comparison ${item.identifier}`}
                onClick={() => setHistoryEdit(item.id)}
              >
                {item.size} · {durationText(item.observedCalendarDays)}
                {overrides.historicalPoints[item.id] !== undefined && <sup>*</sup>}
              </button>
            </div>
          ))}
        </details>
      ) : (
        <div className="estimate-connect-panel">
          <p>Connect a history source to estimate duration from your team’s completed work.</p>
          <button className="secondary" onClick={onConfigureHistory}>
            Configure history
          </button>
        </div>
      )}
    </>
  );
}
/** Apply project-local calibration changes without altering the external historical issue. */
export function HistoryEditor({
  historyItem,
  overrides,
  saveHistory,
  setHistoryEdit,
}: Pick<RequirementEstimatesProps, 'overrides'> & {
  historyItem: HistoryIssue;
  saveHistory: (id: string, points: number | null) => Promise<void>;
  setHistoryEdit: (value: string | null) => void;
}): JSX.Element {
  return (
    <div className="modal-overlay">
      <section
        className="product-workspace estimate-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Historical comparison"
      >
        <header>
          <h2>Historical comparison</h2>
          <p>
            {historyItem.identifier} · {historyItem.title}
          </p>
        </header>
        <p className="estimate-reason">
          This comparison was classified with the same rubric as reviewed requirements.
        </p>
        <div className="estimate-size-options" role="group" aria-label="Comparison complexity">
          {sizes.map((size) => (
            <button
              key={size.points}
              aria-pressed={
                (overrides.historicalPoints[historyItem.id] ?? historyItem.points) === size.points
              }
              onClick={() => void saveHistory(historyItem.id, size.points)}
            >
              {size.label}
            </button>
          ))}
        </div>
        <p className="product-muted">
          Adjusts predictions for this project version. The connected task manager stays unchanged.
        </p>
        {overrides.historicalPoints[historyItem.id] !== undefined && (
          <button className="text-button" onClick={() => void saveHistory(historyItem.id, null)}>
            Reset comparison
          </button>
        )}
        <button className="secondary estimate-close" onClick={() => setHistoryEdit(null)}>
          Close
        </button>
      </section>
    </div>
  );
}
