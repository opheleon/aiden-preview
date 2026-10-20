import { BookOpen, ExternalLink, MessageCircle, Plus, Settings2 } from 'lucide-react';
import { type JSX, useState } from 'react';

import { helpLinks } from '../../../../packages/contracts/src/guide';
import { scopeName } from '../../../../packages/contracts/src/project-name';
import { OutcomeDialog } from '../components/ProjectOutcome';
import { ProjectRow } from '../components/ProjectRow';
import { SidebarUpdate } from '../components/SidebarUpdate';
import type { Workspace } from '../hooks/useWorkspace';
import { newProject } from '../renderer/project-state';
const api = window.aiden;

/** Open a blank project. Runs keep going in the worker; this window just stops following them. */
function startNewProject(workspace: Workspace): void {
  workspace.setBusy(false);
  workspace.setActiveRun('');
  workspace.setActiveRuns([]);
  workspace.setLiveByRun({});
  workspace.setOpenRun('');
  workspace.setLive('');
  workspace.setVerification(null);
  workspace.setArea('projects');
  workspace.setProject(newProject());
  workspace.setBaseline(undefined);
  workspace.setReport(undefined);
  workspace.setRuns([]);
  workspace.setActivity([]);
  workspace.setCalls([]);
  workspace.setError('');
}

/** Projects Aiden is running, plus settings and support. */
export function WorkspaceSidebar({
  workspace,
  onGettingStarted,
}: {
  workspace: Workspace;
  onGettingStarted: () => void;
}): JSX.Element {
  const { projects, project, area, setArea, action } = workspace;
  const [closing, setClosing] = useState<string | null>(null);
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div className="workspace-label">Projects</div>
        <button
          className="sidebar-add"
          aria-label="Create project"
          title="New project"
          onClick={() => startNewProject(workspace)}
        >
          <Plus size={14} />
        </button>
      </div>
      <nav className="project-nav">
        <ProjectLinks workspace={workspace} closed={false} onClose={setClosing} />
        {projects.some((p) => p.lifecycle?.status === 'closed') && (
          <details
            className="closed-projects"
            open={project.lifecycle?.status === 'closed' || undefined}
          >
            <summary>Closed projects</summary>
            <ProjectLinks workspace={workspace} closed onClose={setClosing} />
          </details>
        )}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-section" data-guide-trigger onClick={onGettingStarted}>
          <BookOpen size={17} />
          <span>Help / Getting started</span>
        </button>
        <button
          className={area === 'settings' ? 'sidebar-section selected' : 'sidebar-section'}
          onClick={() => setArea('settings')}
        >
          <Settings2 size={17} />
          <span>Settings</span>
        </button>
        <button
          className="sidebar-section"
          title="Report a problem, suggest a feature, or get help on Slack."
          onClick={() =>
            void action(async () => {
              await api?.openExternal(helpLinks.slack);
            })
          }
        >
          <MessageCircle size={17} />
          <span>Join our Slack</span>
          <ExternalLink size={13} aria-hidden="true" />
        </button>
        <SidebarUpdate
          updateStatus={workspace.updateStatus}
          setUpdateStatus={workspace.setUpdateStatus}
          busy={workspace.busy}
          api={api}
        />
      </div>
      {closing && closing === project.id && (
        <OutcomeDialog workspace={workspace} mode="close" dismiss={() => setClosing(null)} />
      )}
    </aside>
  );
}

/** Separate active and closed projects while retaining access to their saved runs. */
function ProjectLinks({
  workspace,
  closed,
  onClose,
}: {
  workspace: Workspace;
  closed: boolean;
  onClose: (projectId: string) => void;
}): JSX.Element {
  const { projects, project } = workspace;
  return (
    <>
      {projects
        .filter((p) => (p.lifecycle?.status === 'closed') === closed)
        .map((p) => (
          <ProjectRow
            key={p.id}
            workspace={workspace}
            project={p}
            name={
              p.id === project.id ? scopeName(project.context, workspace.baseline?.product) : p.name
            }
            onClose={onClose}
          />
        ))}
    </>
  );
}
