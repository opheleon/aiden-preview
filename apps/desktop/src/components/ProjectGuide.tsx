import { createContext, type JSX, type ReactNode, useContext, useState } from 'react';

import { type Guide, useGuide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import type { ProjectChatEntry } from '../renderer/project-chat-entry';
import type { ProjectTab } from './ProjectTabs';

/** Shared entry point to the selected project's conversation, available from any app surface. */
type ProjectGuideState = {
  guide: Guide;
  /** Show the project's Chat tab, optionally with a requested action or context attached. */
  open: (entry?: ProjectChatEntry) => void;
  /** The action or context attached to the next message, if any. */
  entry: ProjectChatEntry | null;
  clearEntry: () => void;
  /** The selected project tab; every project opens on Chat. */
  tab: ProjectTab;
  /** The person chose the Chat tab, rather than seeing it as the default on opening a project. */
  chatChosen: boolean;
  selectTab: (next: ProjectTab) => void;
  onHelp: () => void;
  /** The unsent message, kept per project while the person visits other pages. */
  draft: string;
  setDraft: (text: string) => void;
  revision: number;
};
const ProjectGuideContext = createContext<ProjectGuideState | null>(null);

/** Access the project conversation and tab selection from any app surface. */
export function useProjectGuide(): ProjectGuideState {
  const context = useContext(ProjectGuideContext);
  if (!context) throw new Error('Project chat needs its workspace provider.');
  return context;
}

/**
 * Keep one project conversation and the selected project tab for every project. Chat is the first
 * tab and the one a project opens on; opening chat from anywhere else, including Settings, returns
 * to the project and selects it, so the person never has to find a second button.
 */
export function ProjectGuide({
  workspace,
  onHelp,
  children,
}: {
  workspace: Workspace;
  onHelp: () => void;
  children: ReactNode;
}): JSX.Element {
  const guide = useGuide(workspace);
  const [tabs, setTabs] = useState<Record<string, ProjectTab>>({});
  const [entries, setEntries] = useState<Record<string, ProjectChatEntry | null>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const id = workspace.project.id;
  /** Select a tab; selecting Chat re-reads setup so settings saved elsewhere show at once. */
  function selectTab(next: ProjectTab): void {
    setTabs((current) => ({ ...current, [id]: next }));
    if (next === 'chat') void guide.reload();
  }
  /** Go to the project's Chat tab from any page, attaching the requested entry. */
  function open(entry?: ProjectChatEntry): void {
    setEntries((current) => ({ ...current, [id]: entry ?? null }));
    if (workspace.area !== 'projects') workspace.setArea('projects');
    selectTab('chat');
  }
  return (
    <ProjectGuideContext.Provider
      value={{
        guide,
        open,
        entry: entries[id] ?? null,
        clearEntry: () => {
          setEntries((current) => ({ ...current, [id]: null }));
          setRevision((current) => current + 1);
        },
        tab: tabs[id] ?? 'chat',
        chatChosen: tabs[id] === 'chat',
        selectTab,
        onHelp,
        draft: drafts[id] ?? '',
        setDraft: (text) => setDrafts((current) => ({ ...current, [id]: text })),
        revision,
      }}
    >
      {children}
    </ProjectGuideContext.Provider>
  );
}
