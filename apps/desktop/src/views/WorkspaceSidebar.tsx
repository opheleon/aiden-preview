import { BookOpen, ExternalLink, MessageCircle, Plus, Settings2 } from 'lucide-react';
import type { JSX } from 'react';

import { scopeName } from '../../../../packages/contracts/src/project-name';
import { SidebarUpdate } from '../components/SidebarUpdate';
import type { Workspace } from '../hooks/useWorkspace';
import { newProject } from '../renderer/project-state';
const api = window.aiden;
const slackInviteUrl =
  'https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw';

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
        <ProjectLinks workspace={workspace} closed={false} />
        {projects.some((p) => p.lifecycle?.status === 'closed') && (
          <details
            className="closed-projects"
            open={project.lifecycle?.status === 'closed' || undefined}
          >
            <summary>Closed projects</summary>
            <ProjectLinks workspace={workspace} closed />
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
              await api?.openExternal(slackInviteUrl);
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
    </aside>
  );
}

/** Separate active and closed projects while retaining access to their saved runs. */
function ProjectLinks({
  workspace,
  closed,
}: {
  workspace: Workspace;
  closed: boolean;
}): JSX.Element {
  const { projects, project, load, area, setArea } = workspace;
  return (
    <>
      {projects
        .filter((p) => (p.lifecycle?.status === 'closed') === closed)
        .map((p) => (
          <div key={p.id}>
            <button
              className={p.id === project.id && area === 'projects' ? 'selected' : ''}
              aria-current={p.id === project.id ? 'page' : undefined}
              onClick={() => void load(p.id)}
            >
              <span className="project-dot" aria-hidden="true" />
              <span
                className="project-name"
                title={
                  p.id === project.id
                    ? scopeName(project.context, workspace.baseline?.product)
                    : p.name
                }
              >
                {p.id === project.id
                  ? scopeName(project.context, workspace.baseline?.product)
                  : p.name}
              </span>
            </button>
            {p.id === project.id && (
              <button
                className={area === 'runs' ? 'project-sub selected' : 'project-sub'}
                onClick={() => {
                  workspace.setOpenRun('');
                  setArea('runs');
                }}
              >
                <span>Runs</span>
                {workspace.activeRuns.length > 0 && (
                  <span
                    className="live-dot"
                    aria-label={`${workspace.activeRuns.length} running`}
                  />
                )}
              </button>
            )}
          </div>
        ))}
    </>
  );
}
