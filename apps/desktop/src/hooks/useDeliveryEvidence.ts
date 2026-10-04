import { useEffect, useState } from 'react';

import type { EstimationSnapshot, Report } from '../../../../packages/contracts/src/index';
import type { Workspace } from './useWorkspace';

/** Load current estimate and previous code assessment, discarding responses after project changes. */
export function useDeliveryEvidence(workspace: Workspace): {
  estimate: EstimationSnapshot | null;
  previous: Report | null;
  error: string;
} {
  const { project, report, runs, call } = workspace;
  const [evidence, setEvidence] = useState<{
    estimate: EstimationSnapshot | null;
    previous: Report | null;
    error: string;
  }>({ estimate: null, previous: null, error: '' });
  const revision = runs.map((r) => `${r.id}:${r.status}`).join(',');
  const priorId = runs.find(
    (r) => r.kind === 'report' && r.status === 'completed' && r.id !== report?.id,
  )?.id;
  useEffect(() => {
    let active = true;
    setEvidence({ estimate: null, previous: null, error: '' });
    void Promise.all([
      call('estimation', { projectId: project.id }),
      priorId ? call('result', { projectId: project.id, runId: priorId }) : Promise.resolve(null),
    ])
      .then(([estimate, previous]) => {
        if (active) setEvidence({ estimate: estimate ?? null, previous, error: '' });
      })
      .catch(() => {
        if (active)
          setEvidence({
            estimate: null,
            previous: null,
            error: 'Delivery estimates could not be loaded.',
          });
      });
    return () => {
      active = false;
    };
  }, [call, project.id, report?.id, priorId, revision]);
  return evidence;
}
