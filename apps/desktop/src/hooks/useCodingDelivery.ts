import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';

import type { CodingJob } from '../../../../packages/contracts/src/index';
import type { Workspace } from './useWorkspace';

/** Shared delivery data, kept current by persisted coding-job events. */
export interface CodingDeliveryState {
  jobs: CodingJob[];
  enabled: boolean;
  setJobs: Dispatch<SetStateAction<CodingJob[]>>;
  error: string;
}

/** Read delivery status on project entry and after background reconciliation saves a job. */
export function useCodingDelivery(workspace: Workspace): CodingDeliveryState {
  const { call, project } = workspace;
  const [enabled, setEnabled] = useState(false);
  const [jobs, setJobs] = useState<CodingJob[]>([]);
  const [error, setError] = useState('');
  const api = window.aiden;
  useEffect(() => {
    let closed = false;
    let sequence = 0;
    /** Read saved status without starting an assessment, coding session, or beta check. */
    const read = async () => {
      const version = ++sequence;
      try {
        const [saved, settings] = await Promise.all([
          call('codingJobs', { projectId: project.id }),
          call('betaSettings', { projectId: project.id }),
        ]);
        if (!closed && version === sequence) {
          setEnabled(settings?.codingAgentEnabled === true);
          setJobs(saved);
          setError('');
        }
      } catch {
        if (!closed && version === sequence) setError('Could not read coding jobs.');
      }
    };
    const unsubscribe = api?.onEvent((event) => {
      if (event.type === 'coding' && event.projectId === project.id) void read();
    });
    void read();
    return () => {
      closed = true;
      unsubscribe?.();
    };
  }, [api, call, project.id]);
  return { jobs, setJobs, enabled, error };
}
