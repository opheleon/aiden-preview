import { useEffect, useState } from 'react';

import type { ActivityEntry, RunEvent } from '../../../../packages/contracts/src/index';
import type { Workspace } from './useWorkspace';
const api = window.aiden;

/** Keep a run's history current: load it, then add each step as the worker reports it. */
export function useRunLog(workspace: Workspace, runId: string): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const { project, call, setError } = workspace;
  useEffect(() => {
    let cancelled = false;
    void call('runLog', { projectId: project.id, runId })
      .then((log) => !cancelled && setEntries(log))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the run.'));
    const stop = api?.onEvent((event: RunEvent) => {
      const entry = event.activity;
      if (event.type !== 'activity' || event.runId !== runId || !entry) return;
      setEntries((log) =>
        log.some((e) => e.at === entry.at && e.summary === entry.summary) ? log : [...log, entry],
      );
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [call, project.id, runId, setError]);
  return entries;
}
