import { ArrowLeft, X } from 'lucide-react';
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { scopeName } from '../../../../packages/contracts/src/project-name';
import { type Guide, useGuide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import type { ProjectChatEntry } from '../renderer/project-chat-entry';
import { GuideChat } from '../views/GuideChat';

/** Shared entry point to the selected project's conversation, available from any app surface. */
type ProjectGuideState = {
  guide: Guide;
  open: (entry?: ProjectChatEntry) => void;
  close: () => void;
  revision: number;
};
const ProjectGuideContext = createContext<ProjectGuideState | null>(null);

/** Access the project conversation without changing the current page or project tab. */
export function useProjectGuide(): ProjectGuideState {
  const context = useContext(ProjectGuideContext);
  if (!context) throw new Error('Project chat needs its workspace provider.');
  return context;
}

/**
 * Keep one project conversation above the current page. First setup opens automatically; Back or
 * Escape restores the prior surface and focus, and reopening preserves the conversation draft.
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
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [entries, setEntries] = useState<Record<string, ProjectChatEntry | null>>({});
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = workspace.project.id;
  const saved = workspace.projects.some((project) => project.id === id);
  const visible = saved && !!opened[id];
  const checked = workspace.runs.some(
    (run) => (run.kind === 'report' || run.kind === 'verify') && run.status === 'completed',
  );
  // Decide the initial presentation once per project; finishing setup never closes the chat.
  if (saved && opened[id] === undefined && (!workspace.baseline || guide.view))
    setOpened({ ...opened, [id]: !checked && !guide.view?.setup.complete });
  useLayoutEffect(() => {
    const element = dialog.current;
    if (visible && element && !element.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!visible && element?.open) element.close();
  }, [visible]);
  /** Close the overlay without changing the page that launched it. */
  function close(): void {
    setOpened((current) => ({ ...current, [id]: false }));
    dialog.current?.close();
    opener.current?.focus();
  }
  /** Re-read setup on opening so settings saved elsewhere are immediately reflected. */
  function open(entry?: ProjectChatEntry): void {
    setEntries((current) => ({ ...current, [id]: entry ?? null }));
    setOpened((current) => ({ ...current, [id]: true }));
    void guide.reload();
  }
  return (
    <ProjectGuideContext.Provider value={{ guide, open, close, revision }}>
      {children}
      <dialog
        ref={dialog}
        className="project-guide-dialog"
        aria-labelledby="project-guide-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <header className="project-guide-header">
          <button onClick={close} aria-label="Back" className="guide-back">
            <ArrowLeft size={18} /> Back
          </button>
          <div className="project-guide-title">
            <h2 id="project-guide-title">Chat with Aiden</h2>
            <p>{scopeName(workspace.project.context, workspace.baseline?.product)}</p>
          </div>
          <button onClick={close} aria-label="Close chat" className="guide-close">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {saved && (
          <GuideChat
            key={`${id}:${workspace.project.lifecycle?.status ?? 'active'}`}
            workspace={workspace}
            guide={guide}
            visible={visible}
            entry={entries[id] ?? null}
            onClearEntry={() => {
              setEntries((current) => ({ ...current, [id]: null }));
              setRevision((current) => current + 1);
            }}
            onHelp={() => {
              close();
              onHelp();
            }}
          />
        )}
      </dialog>
    </ProjectGuideContext.Provider>
  );
}
