import { useEffect } from 'react';

import type { Workspace } from './useWorkspace';

/** How often an open account project checks for work finished on other members' machines. */
const syncMs = 30_000;

/** The error line for a team sync that failed, with the server's reason when it gave one. */
export function teamSyncError(error: unknown): string {
  const reason = error instanceof Error && error.message ? error.message : 'No reason was given.';
  return `Aiden could not sync this project with your team. ${reason}`;
}

/**
 * Keep an open account project current. Reading the account's state brings this machine's copy
 * up to the server's revision; when it moved, reload the project so the brief shows the result.
 */
export function useAccountProjectSync(workspace: Workspace): void {
  const { call, project, busy, load, setError } = workspace;
  const accountId = project.account?.accountId;
  const revision = project.account?.revision ?? 0;
  const projectId = project.id;
  useEffect(() => {
    if (!accountId || busy) return;
    const timer = setInterval(() => {
      void call('accountState', { accountId })
        .then((state) => {
          const latest = state.projects.find((p) => p.id === projectId)?.revision ?? 0;
          if (latest > revision) void load(projectId);
        })
        .catch((error: unknown) => setError(teamSyncError(error)));
    }, syncMs);
    return () => clearInterval(timer);
  }, [call, accountId, revision, projectId, busy, load, setError]);
}
