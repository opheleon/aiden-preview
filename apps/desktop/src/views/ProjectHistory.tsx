import type { JSX } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
import { Activity } from '../components/Activity';
import { DeliveryStatus, deliverySummary } from '../components/DeliveryStatus';
import type { CodingDeliveryState } from '../hooks/useCodingDelivery';
import type { Workspace } from '../hooks/useWorkspace';
import type { Check } from '../renderer/requirement-status';

/** Evidence key shared by recordings and the activity log. */
const resultKey = (r: CriterionResult): string =>
  r.edgeCaseId ? `${r.requirementId}-${r.edgeCaseId}` : r.requirementId;

/** Keep the full run history and its conversations in the project's Activity tab. */
export function ProjectHistory({
  workspace,
  delivery,
  check,
  update,
  onWatch,
}: {
  workspace: Workspace;
  delivery: CodingDeliveryState;
  check: Check | null;
  update: string;
  onWatch: (result: CriterionResult) => void;
}): JSX.Element {
  const { project, baseline, activity, runs } = workspace;
  const latestJob = delivery.jobs.find((job) => job.baselineId === baseline?.id);
  return (
    <Activity
      entries={activity}
      runs={runs}
      projectId={project.id}
      call={workspace.call}
      update={[latestJob ? deliverySummary(latestJob) : '', latestJob?.pullRequestUrl, update]
        .filter(Boolean)
        .join('\n')}
      deliveryActivity={
        delivery.jobs.length > 0 ? (
          <div aria-label="Coding activity">
            {delivery.jobs.map((job) => (
              <div key={job.id}>
                <p className="row-sub">
                  Coding job started {new Date(job.createdAt).toLocaleString()}. Latest saved status
                  {job.baselineId !== baseline?.id ? ' for a previous scope' : ''}:
                </p>
                <DeliveryStatus job={job} />
              </div>
            ))}
          </div>
        ) : undefined
      }
      onOpenRun={(runId) => {
        workspace.setOpenRun(runId);
        workspace.setArea('runs');
      }}
      onWatch={(key) => {
        const result = check?.result.criteria.find((c) => resultKey(c) === key);
        if (result) onWatch(result);
      }}
    />
  );
}
