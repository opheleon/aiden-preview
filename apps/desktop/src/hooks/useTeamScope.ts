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
 * Send new projects to the person's team when they are signed in. There is no choice to make on
 * the start screen; signed out, projects stay local exactly as before. Checked again whenever the
 * person changes screens, so signing in or out shows up right away.
 * @param workspace The workspace whose new-project target is kept current.
 */
export function useTeamScope(workspace: Workspace): void {
  const { call, setAccountScope, setTeamProblem, area } = workspace;
  useEffect(() => {
    if (!window.aiden) return;
    void call('accountStatus')
      .then((status) => {
        const target = teamTarget(status);
        setAccountScope(target.scope);
        setTeamProblem(target.problem);
      })
      .catch(() => {
        setAccountScope('');
        setTeamProblem('');
      });
  }, [call, setAccountScope, setTeamProblem, area]);
}
