import type { JSX } from 'react';

import type {
  CodingJob,
  EstimationSnapshot,
  Product,
  Report,
} from '../../../../packages/contracts/src/index';
import { isBlocking } from '../../../../packages/reporting/src/blockers';
import { remoteDeliveryVerified } from '../../../../packages/reporting/src/delivery-source';
import { useDeliveryEvidence } from '../hooks/useDeliveryEvidence';
import type { Workspace } from '../hooks/useWorkspace';
import {
  type FeatureProgress,
  featureProgress,
  progressChange,
} from '../renderer/delivery-progress';
import { type ItemState, plural } from '../renderer/requirement-status';
import { DeliveryStatus } from './DeliveryStatus';
import { requirementCounts, RequirementProgress } from './RequirementProgress';

/** Project-level direction and evidence confidence, without turning requirement counts into effort. */
export function DeliveryProgress({
  workspace,
  product,
  report,
  states,
  job,
}: {
  workspace: Workspace;
  product: Product;
  report: Report | undefined;
  states: Map<string, ItemState>;
  job?: CodingJob | undefined;
}): JSX.Element {
  const { estimate, previous, error } = useDeliveryEvidence(workspace);
  const features = featureProgress(product, states);
  const current = features.find((f) => !f.complete && !f.blocked && !f.waitingOn.length);
  const counts = requirementCounts(states, product.requirements.length);
  const blocked = workspace.calls.some(isBlocking);
  return (
    <div className="delivery-progress">
      {job && <DeliveryStatus job={job} />}
      <RequirementProgress counts={counts} detail={verificationSummary(states)} />
      {report && !remoteDeliveryVerified(report) && (
        <p className="brief-note" role="status">
          <strong>Branch unverified.</strong> Monitored remote-branch evidence is unavailable. Local
          work is not counted as delivered. Check repository access, then run a new assessment.
        </p>
      )}
      <NextStep
        blocked={blocked}
        job={!!job}
        current={current}
        allDone={counts.done === counts.total}
      />
      <details className="progress-details">
        <summary>Progress details and estimates</summary>
        <div className="progress-detail-content">
          <p>{verificationSummary(states)}</p>
          {features.length > 0 && (
            <p>
              {features.filter((f) => f.complete).length} of {features.length} delivery steps
              complete.
            </p>
          )}
          {!job &&
            (blocked ? (
              <p>
                <strong>Remaining effort:</strong> Waiting for blocking scope decisions. Independent
                tickets can continue.
              </p>
            ) : (
              <RemainingEffort workspace={workspace} report={report} estimate={estimate} />
            ))}
          <p>
            <strong>Agreed timing:</strong>{' '}
            {product.milestones.length ? product.milestones.join(' · ') : 'No target agreed yet.'}
          </p>
          {!job && <p className="row-sub">{progressChange(report, previous)}</p>}
        </div>
      </details>
      {error && (
        <p role="status" className="row-sub">
          {error}
        </p>
      )}
    </div>
  );
}

/** Current sizing is refreshed automatically; a stopped sizing run has an explicit recovery. */
function RemainingEffort({
  workspace,
  report,
  estimate,
}: {
  workspace: Workspace;
  report: Report | undefined;
  estimate: EstimationSnapshot | null;
}): JSX.Element {
  const sized =
    estimate?.baselineId === workspace.baseline?.id && estimate?.reportId === report?.id
      ? estimate
      : null;
  const estimating = workspace.runs.some(
    (r) => r.kind === 'estimate' && workspace.activeRuns.includes(r.id),
  );
  const failedEstimate = workspace.runs.find((r) => r.kind === 'estimate');
  const remaining = sized?.forecast.remainingPoints;
  return (
    <div className="req-block">
      <p>
        <strong>Remaining effort:</strong>{' '}
        {estimating
          ? 'Aiden is sizing the remaining work…'
          : remaining != null
            ? `${remaining} estimated complexity points. Points measure work size, not days.`
            : 'Not established yet.'}
      </p>
      {sized && (
        <details className="estimate-basis">
          <summary>How this is estimated</summary>
          <p className="row-sub">
            Code-based estimate from {new Date(sized.generatedAt).toLocaleDateString()}. Browser
            failures may require additional work. {sized.forecast.limitations.join(' ')}
          </p>
        </details>
      )}
      {!sized &&
        report &&
        failedEstimate &&
        ['failed', 'cancelled'].includes(failedEstimate.status) && (
          <p className="row-sub">
            Sizing did not finish.{' '}
            <button
              className="text-button"
              disabled={workspace.busy}
              onClick={() =>
                void workspace.action(async () => {
                  const run = await workspace.call('estimate', {
                    projectId: workspace.project.id,
                    reportId: report.id,
                  });
                  workspace.setActiveRun(run.runId);
                  workspace.setBusy(true);
                })
              }
            >
              Retry sizing
            </button>
          </p>
        )}
    </div>
  );
}

/** Keep the overview quiet when there is no verification evidence to summarize. */
function verificationSummary(states: Map<string, ItemState>): string {
  const values = [...states.values()];
  const counts = [
    [
      values.filter((s) => s.label === 'Done' && s.tone === 'verified' && s.basis !== 'code')
        .length,
      'verified with recorded checks',
    ],
    [values.filter((s) => s.label === 'Done' && s.basis === 'code').length, 'checked in code'],
    [values.filter((s) => s.tone === 'manual').length, 'confirmed by you'],
  ] as const;
  return (
    counts
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}`)
      .join(' · ') || 'No completed verification yet.'
  );
}

/**
 * The next delivery step. Delivery is paused only when no step is ready; otherwise the current
 * focus stays visible and notes that later steps wait on decisions.
 */
function NextStep({
  blocked,
  job,
  current,
  allDone,
}: {
  blocked: boolean;
  job: boolean;
  current: FeatureProgress | undefined;
  allDone: boolean;
}): JSX.Element {
  if (blocked && !current) return <p>Delivery paused: resolve blocking decisions in Needs you.</p>;
  if (job)
    return (
      <p className="row-sub">
        The requirement counts and plan below reflect the last assessment. Agent completion does not
        mark requirements verified.
      </p>
    );
  if (current)
    return (
      <p>
        <strong>Current focus:</strong>{' '}
        <a href={`#feature-${current.feature.id}`}>{current.feature.title}</a>.{' '}
        {plural(current.total - current.done, 'requirement')} still to complete.
        {blocked && ' Other steps wait on decisions in Needs you.'}
      </p>
    );
  return (
    <p>
      {allDone
        ? 'All planned requirements meet their completion checks.'
        : 'Aiden is establishing the next delivery step.'}
    </p>
  );
}
