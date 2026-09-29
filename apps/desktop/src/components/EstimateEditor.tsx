import type { JSX } from 'react';

import type { RequirementEstimate } from '../../../../packages/contracts/src/index';
import { selectComparisons } from '../../../../packages/estimation/src/index';
import { comparisonSummary, durationText, sizes } from '../renderer/estimate-format';
import type { EstimateEditing, RequirementEstimatesProps } from './estimate-types';

/** Explain remaining change size or its historical time range; only complexity can be overridden. */
export function EstimateEditor({
  editing,
  row,
  report,
  busy,
  saveSize,
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
        <p className="estimate-reason">
          {row.remaining?.reasoning ??
            'Re-estimate to size the remaining change from code evidence.'}
        </p>
        {editing.kind === 'size' ? (
          <>
            <div className="estimate-size-options" role="group" aria-label="Choose complexity">
              {sizes.map((size) => (
                <button
                  key={size.points}
                  disabled={busy}
                  aria-pressed={row.remainingPoints === size.points}
                  onClick={() => void saveSize(row.requirementId, size.points)}
                >
                  {size.label}
                </button>
              ))}
            </div>
            <p className="product-muted">
              Size considers touch points, testing difficulty, and change risk. It is not a time
              estimate.
            </p>
            {row.remainingPointsOverridden && (
              <button
                className="text-button"
                onClick={() => void saveSize(row.requirementId, null)}
              >
                Reset size to suggested
              </button>
            )}
          </>
        ) : (
          <DurationExplanation
            row={row}
            estimation={estimation}
            onOpenExternal={onOpenExternal}
            onConfigureHistory={() => {
              setEditing(null);
              onConfigureHistory();
            }}
          />
        )}
        <button className="secondary estimate-close" onClick={() => setEditing(null)}>
          Close
        </button>
      </section>
    </div>
  );
}

/** Show inspectable timing evidence, matching criteria, and the absence of evidence without accepting guessed days. */
function DurationExplanation({
  row,
  estimation,
  onOpenExternal,
  onConfigureHistory,
}: Pick<RequirementEstimatesProps, 'estimation' | 'onOpenExternal' | 'onConfigureHistory'> & {
  row: RequirementEstimate;
}): JSX.Element {
  const comparisons = selectComparisons(row, estimation.history, row.comparisons);
  const summary = comparisonSummary(row, estimation);
  return (
    <div className="estimate-comparisons">
      {row.remainingPoints === 0 ? (
        <p>No implementation work remains in the accepted assessment.</p>
      ) : summary ? (
        <p className="estimate-reason">
          {summary.p10}–{summary.p90} calendar days observed across {summary.count} comparable
          tickets. Median: {durationText(summary.median)}. This is a historical range, not a
          confidence interval or delivery guarantee.
        </p>
      ) : (
        <div className="estimate-connect-panel">
          <p>
            {estimation.historyCollectedAt
              ? `Only ${comparisons.length} eligible comparisons. At least three completed tickets with start and finish dates are needed. Re-estimate to check recent tickets, or select another history source.`
              : 'Connect your task manager to estimate from your team’s completed work.'}
          </p>
          <button className="secondary" onClick={onConfigureHistory}>
            Configure history
          </button>
        </div>
      )}
      {comparisons.length > 0 && (
        <>
          <p>
            Matches share the remaining change’s size (
            {sizes.find((size) => size.points === row.remainingPoints)?.label}), work type (
            {row.remaining?.workType}), and scope shape (
            {row.remaining?.scopeShape?.replaceAll('_', ' ')}). The LLM selected these analogous
            tickets from the saved 90-day window. Elapsed time includes review and waiting.
          </p>
          <ul>
            {comparisons.map((issue) => (
              <li key={issue.id}>
                {issue.url ? (
                  <button onClick={() => onOpenExternal(issue.url!)}>
                    {issue.identifier} · {issue.title}
                  </button>
                ) : (
                  <span>
                    {issue.identifier} · {issue.title}
                  </span>
                )}
                <p>
                  {durationText(issue.observedCalendarDays)} · {issue.startedAt?.slice(0, 10)} to{' '}
                  {issue.completedAt?.slice(0, 10)}
                </p>
                <p>
                  {row.remaining?.comparisonMatches?.find((match) => match.id === issue.id)
                    ?.reasoning ?? issue.reasoning}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {estimation.historyCollectedAt && (
        <p>History collected {new Date(estimation.historyCollectedAt).toLocaleDateString()}.</p>
      )}
      {estimation.historyLimitations.map((limitation) => (
        <p key={limitation}>{limitation}</p>
      ))}
    </div>
  );
}
