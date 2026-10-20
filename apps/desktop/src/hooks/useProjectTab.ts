import { useProjectGuide } from '../components/ProjectGuide';
import type { ProjectTab } from '../components/ProjectTabs';

/** The selected project tab and how to change it. */
export type ProjectTabState = {
  tab: ProjectTab;
  select: (next: ProjectTab) => void;
};

/**
 * The selected project section, kept per project while the person visits other pages. A Coding
 * selection falls back to Chat when coding delivery is off.
 */
export function useProjectTab(coding: boolean): ProjectTabState {
  const { tab, selectTab } = useProjectGuide();
  return { tab: tab === 'coding' && !coding ? 'chat' : tab, select: selectTab };
}
