import { useEffect } from 'react';

import type { Workspace } from './useWorkspace';

/**
 * Send new projects to the person's team when they are in one. There is no choice to make on the
 * start screen; signed out or without a team, projects stay local exactly as before. Checked again
 * whenever the person changes screens, so joining or leaving a team shows up right away.
 * @param workspace The workspace whose new-project target is kept current.
 */
export function useTeamScope(workspace: Workspace): void {
  const { call, setAccountScope, area } = workspace;
  useEffect(() => {
    if (!window.aiden) return;
    void call('accountStatus')
      .then((status) => setAccountScope(status.signedIn ? (status.accounts[0]?.id ?? '') : ''))
      .catch(() => setAccountScope(''));
  }, [call, setAccountScope, area]);
}
