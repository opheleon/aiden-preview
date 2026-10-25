import type { JSX } from 'react';

import { BetaSchedule } from './components/BetaSchedule';
import { FirstUseGuide } from './components/FirstUseGuide';
import { ProjectGuide } from './components/ProjectGuide';
import { ProjectSettings } from './components/ProjectSettings';
import RuntimeSettings from './components/RuntimeSettings';
import { useAccountProjectSync } from './hooks/useAccountProjectSync';
import { useFirstUse } from './hooks/useFirstUse';
import { useTeamScope } from './hooks/useTeamScope';
import { useWorkspace } from './hooks/useWorkspace';
import type { Area } from './hooks/useWorkspaceState';
import { AccountWork } from './views/AccountWork';
import { Agents } from './views/Agents';
import { ApplicationHeader } from './views/ApplicationHeader';
import { Brief } from './views/Brief';
import { DeviceTesting } from './views/DeviceTesting';
import { MyWork } from './views/MyWork';
import { Runs } from './views/Runs';
import { SetIntent } from './views/SetIntent';
import { SettingsView } from './views/SettingsView';
import { WorkspaceDialogs } from './views/WorkspaceDialogs';
import { WorkspaceFeedback } from './views/WorkspaceFeedback';
import { WorkspaceSidebar } from './views/WorkspaceSidebar';
const api = window.aiden;
/** Screens laid out on their own rather than as the project setup view. */
const ownLayout = new Set<Area>(['settings', 'account', 'work', 'agents']);
/** Screens only team members see. */
const teamScreens: Partial<Record<Area, typeof MyWork>> = { work: MyWork, agents: Agents };

/**
 * Compose the desktop app: a project Aiden has not been handed yet shows Set the intent, and a
 * project it runs shows its brief.
 */
export default function App(): JSX.Element {
  const workspace = useWorkspace();
  useAccountProjectSync(workspace);
  useTeamScope(workspace);
  const guide = useFirstUse(api);
  const { project, setProject, projects, setProjects, diagnostics, busy, area, call, refresh } =
    workspace;
  const saved = projects.some((p) => p.id === project.id);
  const TeamScreen = workspace.accountScope ? teamScreens[area] : undefined;
  const runtimeControls = (
    <RuntimeSettings
      key={project.id}
      runtime={project.runtime}
      diagnostics={diagnostics}
      api={api}
      disabled={busy}
      onRefresh={refresh}
      onChange={(runtime) => setProject((current) => ({ ...current, runtime }))}
      onSave={
        saved
          ? async () => {
              await call('updateRuntime', { projectId: project.id, runtime: project.runtime });
              setProjects(await call('projects'));
            }
          : undefined
      }
    />
  );
  return (
    <ProjectGuide workspace={workspace} onHelp={guide.show}>
      <div className="app" data-guide-ready={!guide.loading}>
        <ApplicationHeader {...workspace} />
        <WorkspaceSidebar workspace={workspace} onGettingStarted={guide.show} />
        <main className={!saved && !ownLayout.has(area) ? 'setup-view' : ''}>
          {area === 'account' ? (
            <AccountWork workspace={workspace} />
          ) : TeamScreen ? (
            <TeamScreen workspace={workspace} />
          ) : area === 'devices' && saved ? (
            <DeviceTesting
              api={api}
              key={project.id}
              project={project}
              busy={busy}
              schedule={<BetaSchedule workspace={workspace} verificationOnly />}
            />
          ) : area === 'settings' ? (
            <SettingsView
              {...workspace}
              runtimeControls={runtimeControls}
              projectSettings={<ProjectSettings workspace={workspace} />}
              feedback={<WorkspaceFeedback workspace={workspace} />}
              api={api}
            />
          ) : area === 'runs' && saved ? (
            <div className="content">
              <WorkspaceFeedback workspace={workspace} />
              <Runs workspace={workspace} />
            </div>
          ) : (
            <div className={saved ? 'content' : 'content starter-content'}>
              <WorkspaceFeedback workspace={workspace} />
              {saved ? (
                <Brief key={workspace.project.id} workspace={workspace} />
              ) : (
                <SetIntent workspace={workspace} />
              )}
            </div>
          )}
        </main>
        <WorkspaceDialogs workspace={workspace} />
        {guide.open && <FirstUseGuide guide={guide} />}
      </div>
    </ProjectGuide>
  );
}
