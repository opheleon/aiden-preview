import {
  BookOpen,
  ExternalLink,
  LogIn,
  LogOut,
  MessageCircle,
  Plus,
  Settings2,
} from 'lucide-react';
import { type JSX, useState } from 'react';

import { helpLinks } from '../../../../packages/contracts/src/guide';
import { scopeName } from '../../../../packages/contracts/src/project-name';
import type { OutcomeRequest } from '../components/ProjectMenu';
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

/**
 * Sign in to Teams or sign out, matching where this computer stands. Signing in opens the browser
 * and shows the Teams tab in Settings while it waits; signing out leaves the team screens.
 */
function TeamsSignIn({ workspace }: { workspace: Workspace }): JSX.Element {
  const { signedIn, setSignedIn, setAccountScope, area, setArea, setSettingsTab, action, call } =
    workspace;
  if (!signedIn)
    return (
      <button
        className="sidebar-section"
        onClick={() =>
          void action(async () => {
            setSettingsTab('teams');
            setArea('settings');
            await call('accountSignIn');
          })
        }
      >
        <LogIn size={17} />
        <span>Sign in</span>
      </button>
    );
  return (
    <button
      className="sidebar-section"
      onClick={() =>
        void action(async () => {
          await call('accountSignOut');
          setSignedIn(false);
          setAccountScope('');
          if (area === 'work') setArea('projects');
        })
      }
    >
      <LogOut size={17} />
      <span>Sign out</span>
    </button>
  );
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
  const [outcome, setOutcome] = useState<OutcomeRequest | null>(null);
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
        <ProjectLinks workspace={workspace} closed={false} onOutcome={setOutcome} />
        {projects.some((p) => p.lifecycle?.status === 'closed') && (
          <details
            className="closed-projects"
            open={project.lifecycle?.status === 'closed' || undefined}
          >
            <summary>Closed projects</summary>
            <ProjectLinks workspace={workspace} closed onOutcome={setOutcome} />
          </details>
        )}
      </nav>
      <div className="sidebar-bottom">
        <TeamsSignIn workspace={workspace} />
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
      {outcome && outcome.projectId === project.id && (
        <OutcomeDialog workspace={workspace} mode={outcome.mode} dismiss={() => setOutcome(null)} />
      )}
    </aside>
  );
}

/** Projects shown before Show more; the open project always stays visible. */
const listed = 5;

/** Separate active and closed projects; long lists show the newest few until Show more. */
function ProjectLinks({
  workspace,
  closed,
  onOutcome,
}: {
  workspace: Workspace;
  closed: boolean;
  onOutcome: (request: OutcomeRequest) => void;
}): JSX.Element {
  const { projects, project } = workspace;
  const [all, setAll] = useState(false);
  const group = projects.filter((p) => (p.lifecycle?.status === 'closed') === closed);
  const shown = all ? group : group.filter((p, index) => index < listed || p.id === project.id);
  return (
    <>
      {shown.map((p) => (
        <ProjectRow
          key={p.id}
          workspace={workspace}
          project={p}
          name={
            p.id === project.id ? scopeName(project.context, workspace.baseline?.product) : p.name
          }
          onOutcome={onOutcome}
        />
      ))}
      {group.length > listed && (
        <button className="project-more" onClick={() => setAll(!all)}>
          {all ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}
