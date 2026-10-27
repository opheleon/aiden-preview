import { useEffect } from 'react';

import type { SetupProgress } from '../../../../packages/contracts/src/guide';
import { teamSyncError } from './useAccountProjectSync';
import type { Workspace } from './useWorkspace';

/**
 * When a team project's current setup step changes on this machine (for example after "Looks
 * right"), close the finished step's team task and queue the next one for the person who does it.
 * Solo projects never call the team server.
 * @param workspace The open project and the worker bridge.
 * @param view The project's guide view once loaded; its setup names the current step.
 */
export function useTeamSetupSync(
  workspace: Workspace,
  view: { setup: SetupProgress } | null | undefined,
): void {
  const { call, project, setError } = workspace;
  const next = view?.setup.next;
  const team = !!project.account;
  const projectId = project.id;
  useEffect(() => {
    if (!team || next === undefined) return;
    void call('accountSyncSetup', { projectId }).catch((error: unknown) =>
      setError(teamSyncError(error)),
    );
  }, [call, team, projectId, next, setError]);
}
