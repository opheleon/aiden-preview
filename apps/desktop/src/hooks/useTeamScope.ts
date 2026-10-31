import { useEffect } from 'react';

import type { AccountStatus } from '../../../../packages/contracts/src/api';
import type { Workspace } from './useWorkspace';

/**
 * Where new projects go for this sign-in state: the team when signed in, this computer when
 * signed out. Signed in but unable to reach the team, there is no target and a reason instead,
 * so a new project is never quietly kept on this computer when the person expects their team.
 * @param status The latest account status.
 */
export function teamTarget(status: AccountStatus): { scope: string; problem: string } {
  if (!status.signedIn) return { scope: '', problem: '' };
  const scope = status.accounts[0]?.id ?? '';
  return {
    scope,
    problem: scope ? '' : (status.message ?? 'Aiden could not reach your team.'),
  };
}

/**
 * Show the team screens when the person is signed in to a team, and Sign in or Sign out to match.
 * Checked again whenever the person changes screens, so signing in or out shows up right away. A new project checks its team again
 * when it is created, so this lagging behind never decides where a project goes.
 * @param workspace The workspace whose new-project target is kept current.
 */
export function useTeamScope(workspace: Workspace): void {
  const { call, setAccountScope, setSignedIn, area } = workspace;
  useEffect(() => {
    if (!window.aiden) return;
    void call('accountStatus')
      .then((status) => {
        setAccountScope(teamTarget(status).scope);
        setSignedIn(status.signedIn);
      })
      .catch(() => setAccountScope(''));
  }, [call, setAccountScope, setSignedIn, area]);
}
