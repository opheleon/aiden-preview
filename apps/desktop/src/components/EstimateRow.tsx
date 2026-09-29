import type { JSX } from 'react';

import type { RequirementEstimate } from '../../../../packages/contracts/src/index';
import { comparisonSummary, durationText, sizes } from '../renderer/estimate-format';
import type { EstimateEditing, RequirementEstimatesProps } from './estimate-types';

/** Pair a requirement with its editable change size, history-based time, and remaining work. */
export function EstimateRow({
  item,
  report,
  busy,
  setEditing,
  estimation,
}: Pick<RequirementEstimatesProps, 'report' | 'busy' | 'estimation'> & {
  item: RequirementEstimate;
  setEditing: (value: EstimateEditing) => void;
}): JSX.Element {
  const text = report.baseline.requirements.find((value) => value.id === item.requirementId)?.text;
  return (
    <article className="estimate-row" key={item.requirementId}>
      <div className="estimate-requirement">
        <span className="project-requirement-id">{item.requirementId}</span>
        <p>{text}</p>
      </div>
      <EstimateControls item={item} busy={busy} estimation={estimation} setEditing={setEditing} />
      <RemainingWork item={item} />
    </article>
  );
}
/** Keep change size and history-derived time together while disabling edits for complete or unknown work. */
function EstimateControls({
  item,
  busy,
  estimation,
  setEditing,
}: Pick<RequirementEstimatesProps, 'busy' | 'estimation'> & {
  item: RequirementEstimate;
  setEditing: (value: EstimateEditing) => void;
}): JSX.Element {
  const summary = comparisonSummary(item, estimation);
  return (
    <div className="estimate-controls">
      <button
        className="estimate-value estimate-size"
        aria-label={`Edit complexity ${item.requirementId}`}
        disabled={busy || item.remainingPoints === null || item.remainingPoints === 0}
        onClick={() => setEditing({ id: item.requirementId, kind: 'size' })}
      >
        {item.remainingPoints === 0
          ? 'Done'
          : (sizes.find((size) => size.points === item.remainingPoints)?.label ?? 'Unknown')}
        {item.remainingPointsOverridden && <sup title="Manual override">*</sup>}
      </button>
      <button
        className={`estimate-value estimate-time ${!summary ? 'is-unknown' : ''}`}
        aria-label={`Explain duration ${item.requirementId}`}
        disabled={busy}
        onClick={() => {
          setEditing({ id: item.requirementId, kind: 'duration' });
        }}
      >
        {item.remainingPoints === 0
          ? 'No work left'
          : summary
            ? `${summary.p10}–${durationText(summary.p90)}`
            : 'Unavailable'}
      </button>
    </div>
  );
}

/** Show remaining scope and unanswered questions independently of the original scope estimate. */
function RemainingWork({ item }: { item: RequirementEstimate }): JSX.Element {
  return (
    <details className="estimate-evidence">
      <summary>
        Remaining work ·{' '}
        {item.remainingPoints === null ? 'not yet estimated' : `${item.remainingPoints} points`}
      </summary>
      <p>
        {item.remaining?.reasoning ??
          'Run a code assessment and re-estimate to identify remaining changes.'}
      </p>
      {item.remaining?.workItems.length ? (
        <ul>
          {item.remaining.workItems.map((work) => (
            <li key={work.id}>{work.text}</li>
          ))}
        </ul>
      ) : null}
      {item.remaining?.unknowns.length ? (
        <>
          <p>Unresolved questions</p>
          <ul>
            {item.remaining.unknowns.map((unknown, index) => (
              <li key={index}>{unknown}</li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
  );
}
