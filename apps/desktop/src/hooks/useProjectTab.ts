import { useState } from 'react';

import type { ProjectTab } from '../components/ProjectTabs';
import type { Workspace } from './useWorkspace';

/** The selected project tab, independent of the project chat overlay. */
export type ProjectTabState = {
  tab: ProjectTab;
  select: (next: ProjectTab) => void;
};

/** Remember the selected project section while chat opens and closes above it. */
export function useProjectTab(workspace: Workspace, coding: boolean): ProjectTabState {
  const [selected, setSelected] = useState<Record<string, ProjectTab>>({});
  const saved = selected[workspace.project.id] ?? 'overview';
  return {
    tab: saved === 'coding' && !coding ? 'overview' : saved,
    select: (next) => setSelected((current) => ({ ...current, [workspace.project.id]: next })),
  };
}
