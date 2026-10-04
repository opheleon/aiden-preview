import type { JSX } from 'react';

import { ProjectSettings } from './components/ProjectSettings';
import RuntimeSettings from './components/RuntimeSettings';
import { useWorkspace } from './hooks/useWorkspace';
import { ApplicationHeader } from './views/ApplicationHeader';
import { Brief } from './views/Brief';
import { Runs } from './views/Runs';
import { SetIntent } from './views/SetIntent';
import { SettingsView } from './views/SettingsView';
import { WorkspaceDialogs } from './views/WorkspaceDialogs';
import { WorkspaceFeedback } from './views/WorkspaceFeedback';
import { WorkspaceSidebar } from './views/WorkspaceSidebar';
const api = window.aiden;

/**
 * Compose the desktop app: a project Aiden has not been handed yet shows Set the intent, and a
 * project it runs shows its brief.
 */
export default function App(): JSX.Element {
  const workspace = useWorkspace();
  const { project, setProject, projects, setProjects, diagnostics, busy, area, call, refresh } =
    workspace;
  const saved = projects.some((p) => p.id === project.id);
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
    <div className="app">
      <ApplicationHeader {...workspace} />
      <WorkspaceSidebar workspace={workspace} />
      <main className={!saved && area !== 'settings' ? 'setup-view' : ''}>
        {area === 'settings' ? (
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
    </div>
  );
}
