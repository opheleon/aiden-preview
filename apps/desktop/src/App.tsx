import type { JSX } from 'react';

import RuntimeSettings from './components/RuntimeSettings';
import { useWorkspace } from './hooks/useWorkspace';
import { newProject } from './renderer/project-state';
import { ApplicationHeader } from './views/ApplicationHeader';
import { DraftsView } from './views/DraftsView';
import { ProjectWorkspace } from './views/ProjectWorkspace';
import { SettingsView } from './views/SettingsView';
import { WorkspaceDialogs } from './views/WorkspaceDialogs';
import { WorkspaceSidebar } from './views/WorkspaceSidebar';
const api = window.aiden;
const slackInviteUrl =
  'https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw';

/** Compose desktop navigation around the typed workspace controller. */
export default function App(): JSX.Element {
  const workspace = useWorkspace();
  const {
    project,
    setProject,
    projects,
    setProjects,
    step,
    diagnostics,
    busy,
    baseline,
    runs,
    area,
    call,
    refresh,
  } = workspace;
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
        projects.some((p) => p.id === project.id)
          ? async () => {
              await call('updateRuntime', { projectId: project.id, runtime: project.runtime });
              setProjects(await call('projects'));
            }
          : undefined
      }
    />
  );
  const terminalRuns = runs.filter(
    (r) =>
      r.kind === 'report' ||
      (r.kind !== 'verify' && ['failed', 'cancelled', 'running', 'waiting'].includes(r.status)),
  );
  return (
    <div className="app">
      <ApplicationHeader {...workspace} />
      <WorkspaceSidebar
        {...workspace}
        newProject={newProject}
        terminalRuns={terminalRuns}
        api={api}
        slackInviteUrl={slackInviteUrl}
      />
      <main className={step === 0 ? 'setup-view' : ''}>
        {area === 'settings' ? (
          <SettingsView
            {...workspace}
            runtimeControls={runtimeControls}
            baseline={baseline}
            api={api}
          />
        ) : area === 'drafts' ? (
          <DraftsView {...workspace} />
        ) : (
          <>
            <ProjectWorkspace
              workspace={workspace}
              runtimeControls={runtimeControls}
              terminalRuns={terminalRuns}
            />
          </>
        )}
      </main>
      <WorkspaceDialogs workspace={workspace} />
    </div>
  );
}
