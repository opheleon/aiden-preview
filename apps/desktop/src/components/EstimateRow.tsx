import type { JSX } from 'react';

import type { Report, RequirementEstimate } from '../../../../packages/contracts/src/index';
import { durationText, sizes } from '../renderer/estimate-format';
import type { EstimateEditing, RequirementEstimatesProps } from './estimate-types';
const statusBadges: Record<
  Report['assessments'][number]['status'],
  { label: string; tone: string }
> = {
  implemented: { label: 'Implemented', tone: 'satisfied' },
  partial: { label: 'Partially implemented', tone: 'partial' },
  missing: { label: 'Not implemented', tone: 'incomplete' },
  unknown: { label: 'Not assessed', tone: 'neutral' },
};
/** Pair a requirement's status with editable size/duration and recorded evidence links. */
export function EstimateRow({
  item,
  report,
  busy,
  setEditing,
  setDays,
  onOpenEvidence,
}: Pick<RequirementEstimatesProps, 'report' | 'busy' | 'onOpenEvidence'> & {
  item: RequirementEstimate;
  setEditing: (value: EstimateEditing) => void;
  setDays: (value: string) => void;
}): JSX.Element {
  const assessmentIndex = report.assessments.findIndex(
    (value) => value.requirementId === item.requirementId,
  );
  const status = assessmentIndex >= 0 ? report.assessments[assessmentIndex] : undefined;
  const text = report.baseline.requirements.find((value) => value.id === item.requirementId)?.text;
  return (
    <article className="estimate-row" key={item.requirementId}>
      <div className="estimate-requirement">
        <span className="project-requirement-id">{item.requirementId}</span>
        <p>{text}</p>
      </div>
      <div className="estimate-controls">
        <div className="estimate-status">
          <span
            className={`project-status-badge project-status-badge--${statusBadges[status?.status ?? 'missing'].tone}`}
          >
            {statusBadges[status?.status ?? 'missing'].label}
          </span>
          {status?.deviation && (
            <span className="project-status-badge project-status-badge--deviated">Deviated</span>
          )}
        </div>
        <button
          className="estimate-value estimate-size"
          aria-label={`Edit complexity ${item.requirementId}`}
          disabled={busy}
          onClick={() => setEditing({ id: item.requirementId, kind: 'size' })}
        >
          {sizes.find((size) => size.points === item.points)?.label ?? item.original.size}
          {item.pointsOverridden && <sup title="Manual override">*</sup>}
        </button>
        <button
          className={`estimate-value estimate-time ${item.durationDays === null ? 'is-unknown' : ''}`}
          aria-label={`Edit duration ${item.requirementId}`}
          disabled={busy}
          onClick={() => {
            setDays(String(item.durationDays ?? ''));
            setEditing({ id: item.requirementId, kind: 'duration' });
          }}
        >
          {durationText(item.durationDays)}
          {item.durationOverridden && <sup title="Manual override">*</sup>}
        </button>
      </div>
      {status && (
        <AssessmentEvidence
          status={status}
          assessmentIndex={assessmentIndex}
          onOpenEvidence={onOpenEvidence}
        />
      )}
      <RemainingWork item={item} />
    </article>
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

/** Link each implementation claim to its recorded source evidence and deviation explanation. */
function AssessmentEvidence({
  status,
  assessmentIndex,
  onOpenEvidence,
}: {
  status: Report['assessments'][number];
  assessmentIndex: number;
  onOpenEvidence: RequirementEstimatesProps['onOpenEvidence'];
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
