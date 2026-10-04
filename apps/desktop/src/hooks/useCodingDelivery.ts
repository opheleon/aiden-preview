import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

import type { CodingJob } from '../../../../packages/contracts/src/index';
import type { Workspace } from './useWorkspace';

/** Shared delivery data and its explicit refresh action. */
export interface CodingDeliveryState {
  jobs: CodingJob[];
  enabled: boolean;
  setJobs: Dispatch<SetStateAction<CodingJob[]>>;
  refreshing: boolean;
  error: string;
  refresh: () => Promise<void>;
}

/** One project-scoped delivery snapshot shared by the brief and coding controls. */
export function useCodingDelivery(workspace: Workspace): CodingDeliveryState {
  const { call, project } = workspace;
  const [enabled, setEnabled] = useState(false);
  const [jobs, setJobs] = useState<CodingJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    active.current = true;
    let closed = false;
    /** Read persisted status without starting an assessment or a coding session. */
    const read = async () => {
      const version = ++sequence.current;
      try {
        const [saved, settings] = await Promise.all([
          call('codingJobs', { projectId: project.id }),
          call('betaSettings', { projectId: project.id }),
        ]);
        if (!closed && version === sequence.current)
          setEnabled(settings?.codingAgentEnabled === true);
        if (!closed && version === sequence.current) setJobs(saved);
      } catch {
        if (!closed && version === sequence.current) setError('Could not read coding jobs.');
      }
    };
    void read();
    return () => {
      closed = true;
      active.current = false;
      sequence.current++;
    };
  }, [call, project.id]);
  /** Reconcile GitHub and publish a single result to every delivery view. */
  async function refresh(): Promise<void> {
    const version = ++sequence.current;
    setRefreshing(true);
    setError('');
    try {
      const saved = await call('reconcileDelivery', { projectId: project.id });
      const [state, verification, activity, calls, confirmed] = await Promise.all([
        call('state', { projectId: project.id }),
        call('verification', { projectId: project.id }),
        call('activity', { projectId: project.id }),
        call('calls', { projectId: project.id }),
        call('confirmations', { projectId: project.id }),
      ]);
      const latest = state.runs.find((run) => run.kind === 'report' && run.status === 'completed');
      const report = latest
        ? await call('result', { projectId: project.id, runId: latest.id })
        : undefined;
      if (active.current && version === sequence.current) {
        setJobs(saved);
        workspace.setBaseline(state.baseline ?? undefined);
        workspace.setRuns(state.runs);
        workspace.setVerification(verification);
        workspace.setActivity(activity);
        workspace.setCalls(calls);
        workspace.setConfirmed(confirmed);
        workspace.setReport(report);
      }
    } catch {
      if (active.current && version === sequence.current)
        setError('Could not refresh delivery status. Try again.');
    } finally {
      if (active.current && version === sequence.current) setRefreshing(false);
    }
  }
  return { jobs, setJobs, enabled, refreshing, error, refresh };
}
