import { type JSX, useState } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import { Runs } from './Runs';

/** Keep run browsing inside Activity and mount its details only when requested. */
export function ProjectRunHistory({
  workspace,
  visible,
}: {
  workspace: Workspace;
  visible: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(!!workspace.openRun);
  const [lastRun, setLastRun] = useState(workspace.openRun);
  if (workspace.openRun !== lastRun) {
    setLastRun(workspace.openRun);
    if (workspace.openRun) setExpanded(true);
  }
  return (
    <details
      className="project-run-history"
      open={expanded}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>All runs</summary>
      {visible && expanded && <Runs workspace={workspace} />}
    </details>
  );
}
