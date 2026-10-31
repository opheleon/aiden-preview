import { ChevronRight, Plug, Settings2, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type {
  IntegrationPreset,
  McpConnection,
  McpTool,
  Project,
} from '../../../../packages/contracts/src/index';
import {
  experimentalIntegration,
  readOnlyLinear,
} from '../../../../packages/contracts/src/tracker-connections';
import type { DesktopBridge } from '../bridge';
import { CredentialStorageNote } from '../components/CredentialStorageNote';
import type { Area, SettingsTab } from '../hooks/useWorkspaceState';
import type { UpdatePreferences, UpdateStatus } from '../updater';
import { BackgroundSettingsCard } from '../views/BackgroundSettings';
import { DesktopUpdateSettings } from '../views/DesktopUpdateSettings';
import { IntegrationConnectionCard } from '../views/IntegrationConnectionCard';

interface SettingsViewProps {
  settingsTab: SettingsTab;
  setSettingsTab: React.Dispatch<React.SetStateAction<SettingsTab>>;
  project: Project;
  load: (id: string) => Promise<void>;
  setArea: React.Dispatch<React.SetStateAction<Area>>;
  projects: Project[];
  runtimeControls: React.JSX.Element;
  projectSettings: React.JSX.Element;
  /** The Teams tab: sign-in, the team, its machines, and how this machine helps. */
  teams: React.JSX.Element;
  /** Errors and notices from actions taken in settings. */
  feedback: React.JSX.Element;
  api: DesktopBridge | undefined;
  action: (fn: () => Promise<void>) => Promise<void>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  setIntegrations: React.Dispatch<React.SetStateAction<McpConnection[]>>;
  integrations: McpConnection[];
  setIntegrationTools: React.Dispatch<React.SetStateAction<Record<string, McpTool[]>>>;
  integrationTools: Record<string, McpTool[]>;
  refresh: () => Promise<void>;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  updateStatus: UpdateStatus | undefined;
  updatePreferences: UpdatePreferences;
  saveUpdatePreferences: (next: UpdatePreferences) => void;
  setUpdateStatus: React.Dispatch<React.SetStateAction<UpdateStatus | undefined>>;
  busy: boolean;
}

/** Configure the selected project, provider access, integration permissions, and desktop preferences. */
export function SettingsView(props: SettingsViewProps): React.JSX.Element {
  const {
    settingsTab,
    setSettingsTab,
    project,
    load,
    setArea,
    projects,
    runtimeControls,
    projectSettings,
    teams,
    feedback,
    api,
    updateStatus,
    updatePreferences,
    saveUpdatePreferences,
    setUpdateStatus,
    busy,
  } = props;
  return (
    <div className="content settings-view">
      <div className="breadcrumb">
        Aiden <ChevronRight size={13} />
        <strong>Settings</strong>
      </div>
      <div className="title-row">
        <div>
          <h1>
            Application <span className="serif">settings.</span>
          </h1>
          <p className="subtitle">This project, models, connected tools, and local preferences.</p>
        </div>
      </div>
      {feedback}
      <div className="settings-tabs">
        {(['project', 'model', 'integrations', 'teams', 'preferences', 'desktop'] as const).map(
          (tab) => (
            <button
              key={tab}
              className={settingsTab === tab ? 'active' : ''}
              onClick={() => setSettingsTab(tab)}
            >
              {tab === 'desktop' ? 'Desktop app' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ),
        )}
      </div>
      {settingsTab === 'model' && (
        <div className="settings-stack">
          <label>
            Project
            <select
              aria-label="Model settings project"
              value={project.id}
              onChange={(e) => {
                void load(e.target.value).then(() => setArea('settings'));
              }}
            >
              {!projects.some((p) => p.id === project.id) && (
                <option value={project.id}>{project.name || 'New project'}</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {runtimeControls}
        </div>
      )}
      {settingsTab === 'project' && projectSettings}
      {settingsTab === 'teams' && teams}
      {settingsTab === 'integrations' && (
        <div className="settings-stack">
          <section className="card integration-hero">
            <div>
              <div className="eyebrow">HOSTED MCP</div>
              <h2>Connect work context</h2>
              <p>
                Connections are shared by Claude and Codex. Linear: Aiden reads tickets, and
                publishes them once you choose a destination in Project settings. Notion: Aiden
                reads the pages you link, using only Notion’s fetch and search tools, which
                connecting approves.
              </p>
              <CredentialStorageNote connection="Linear or Notion" />
            </div>
            <div className="button-row">
              <PresetConnection {...props} provider="linear" />
              <PresetConnection {...props} provider="notion" />
            </div>
          </section>
          <p className="fine-print">
            Jira and custom MCP are experimental. New connections are hidden while we complete
            end-to-end testing. Saved experimental connections remain available for existing
            projects.
          </p>
          <SavedConnections {...props} />
        </div>
      )}
      <PreferenceSettings {...props} />
      {settingsTab === 'desktop' && (
        <>
          <DesktopUpdateSettings
            updateStatus={updateStatus}
            updatePreferences={updatePreferences}
            saveUpdatePreferences={saveUpdatePreferences}
            api={api}
            setUpdateStatus={setUpdateStatus}
            busy={busy}
          />
          <BackgroundSettingsCard api={api} />
        </>
      )}
    </div>
  );
}

/** Explain local storage, credential handling, and the absence of usage tracking. */
function PreferenceSettings(props: SettingsViewProps): React.JSX.Element {
  const { settingsTab } = props;
  return (
    <>
      {settingsTab === 'preferences' && (
        <>
          <section className="card settings-panel">
            <div className="card-heading">
              <div className="section-icon">
                <Settings2 size={19} />
              </div>
              <div>
                <h2>Local preferences</h2>
                <p>Aiden stores project artifacts in its application data folder.</p>
              </div>
            </div>
            <div className="inline-note">
              <ShieldCheck size={16} />
              <span>
                Source repositories remain read-only during assessment. Reports and estimates
                publish independently.
              </span>
            </div>
            <p className="fine-print">
              Credentials are stored in the operating system credential store when available.
              Session-only authentication is offered when secure storage is unavailable. Aiden does
              not collect usage metrics or upload local diagnostics.
            </p>
          </section>
        </>
      )}
    </>
  );
}

/** Offer one-click Linear or Notion setup while preserving experimental accounts for existing projects. */
function PresetConnection({
  busy,
  action,
  setBusy,
  call,
  setIntegrations,
  provider,
}: SettingsViewProps & { provider: Exclude<IntegrationPreset, 'jira'> }): React.JSX.Element {
  return (
    <button
      className="primary integration-connect"
      disabled={busy}
      onClick={() =>
        void action(async () => {
          setBusy(true);
          try {
            const connection = await call('integrationPreset', { provider });
            if (connection.status !== 'authorization_required')
              await call('integrationConnect', { connectionId: connection.id });
          } finally {
            setBusy(false);
            setIntegrations(await call('integrations'));
          }
        })
      }
    >
      <Plug size={15} /> Connect {provider === 'linear' ? 'Linear' : 'Notion'}
    </button>
  );
}

/** Keep older readers available without presenting them as additional publishing accounts. */
function SavedConnections(props: SettingsViewProps): React.JSX.Element {
  const {
    integrations,
    action,
    call,
    setIntegrations,
    setIntegrationTools,
    integrationTools,
    refresh,
    setNotice,
  } = props;
  // A run can change a connection's status after startup, for example when its tools change.
  useEffect(() => {
    void call('integrations')
      .then(setIntegrations)
      .catch(() => undefined);
  }, [call, setIntegrations]);
  return (
    <>
      {integrations
        .filter((c) => !readOnlyLinear(c) && !experimentalIntegration(c))
        .map((connection) => (
          <IntegrationConnectionCard
            key={connection.id}
            connection={connection}
            action={action}
            call={call}
            setIntegrations={setIntegrations}
            setIntegrationTools={setIntegrationTools}
            integrationTools={integrationTools}
            refresh={refresh}
            setNotice={setNotice}
          />
        ))}
      {integrations.some(experimentalIntegration) && (
        <details>
          <summary>
            Experimental connections ({integrations.filter(experimentalIntegration).length})
          </summary>
          <p>
            Saved Jira and custom MCP connections are preserved for existing projects. Live
            end-to-end testing is incomplete.
          </p>
          {integrations.filter(experimentalIntegration).map((connection) => (
            <IntegrationConnectionCard
              key={connection.id}
              connection={connection}
              action={action}
              call={call}
              setIntegrations={setIntegrations}
              setIntegrationTools={setIntegrationTools}
              integrationTools={integrationTools}
              refresh={refresh}
              setNotice={setNotice}
            />
          ))}
        </details>
      )}
      {integrations.some(readOnlyLinear) && (
        <details>
          <summary>
            Older read-only Linear connections ({integrations.filter(readOnlyLinear).length})
          </summary>
          <p>
            These are saved connections from earlier setup. Publishing uses the read/write
            connection above. They remain available for projects using them as context.
          </p>
          {integrations.filter(readOnlyLinear).map((connection) => (
            <IntegrationConnectionCard
              key={connection.id}
              connection={connection}
              action={action}
              call={call}
              setIntegrations={setIntegrations}
              setIntegrationTools={setIntegrationTools}
              integrationTools={integrationTools}
              refresh={refresh}
              setNotice={setNotice}
            />
          ))}
        </details>
      )}
    </>
  );
}
