import { ChevronRight, Plug, Settings2, ShieldCheck } from 'lucide-react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type {
  Baseline,
  McpConnection,
  McpTool,
  Project,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import ScheduleSettings from '../components/ScheduleSettings';
import type { UpdatePreferences, UpdateStatus } from '../updater';
import { CustomServerForm } from '../views/CustomServerForm';
import { DesktopUpdateSettings } from '../views/DesktopUpdateSettings';
import { IntegrationConnectionCard } from '../views/IntegrationConnectionCard';

interface SettingsViewProps {
  settingsTab: 'model' | 'schedule' | 'integrations' | 'preferences' | 'desktop';
  setSettingsTab: React.Dispatch<
    React.SetStateAction<'model' | 'schedule' | 'integrations' | 'preferences' | 'desktop'>
  >;
  project: Project;
  load: (id: string) => Promise<void>;
  setArea: React.Dispatch<React.SetStateAction<'projects' | 'drafts' | 'settings'>>;
  projects: Project[];
  runtimeControls: React.JSX.Element;
  baseline: Baseline | undefined;
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
  customServer: {
    name: string;
    url: string;
    auth: 'oauth' | 'bearer' | 'none';
    bearer: string;
    clientId: string;
    sessionOnly: boolean;
  };
  setCustomServer: React.Dispatch<
    React.SetStateAction<{
      name: string;
      url: string;
      auth: 'oauth' | 'bearer' | 'none';
      bearer: string;
      clientId: string;
      sessionOnly: boolean;
    }>
  >;
  updateStatus: UpdateStatus | undefined;
  updatePreferences: UpdatePreferences;
  saveUpdatePreferences: (next: UpdatePreferences) => void;
  setUpdateStatus: React.Dispatch<React.SetStateAction<UpdateStatus | undefined>>;
  busy: boolean;
}

/** Configure provider access, integration permissions, schedules, and desktop preferences. */
export function SettingsView(props: SettingsViewProps): React.JSX.Element {
  const {
    settingsTab,
    setSettingsTab,
    project,
    load,
    setArea,
    projects,
    runtimeControls,
    baseline,
    api,
    action,
    setBusy,
    call,
    setIntegrations,
    integrations,
    setIntegrationTools,
    integrationTools,
    refresh,
    setNotice,
    customServer,
    setCustomServer,
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
          <p className="subtitle">Models, read-only context connections, and local preferences.</p>
        </div>
      </div>
      <div className="settings-tabs">
        {(['model', 'schedule', 'integrations', 'preferences', 'desktop'] as const).map((tab) => (
          <button
            key={tab}
            className={settingsTab === tab ? 'active' : ''}
            onClick={() => setSettingsTab(tab)}
          >
            {tab === 'desktop' ? 'Desktop app' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
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
      {settingsTab === 'schedule' && (
        <ScheduleSettings key={project.id} project={project} baseline={baseline} api={api} />
      )}
      {settingsTab === 'integrations' && (
        <div className="settings-stack">
          <section className="card integration-hero">
            <div>
              <div className="eyebrow">HOSTED MCP</div>
              <h2>Connect work context</h2>
              <p>
                Connections are shared by Claude and Codex. Aiden only exposes read tools you
                approve.
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                void action(async () => {
                  setBusy(true);
                  const connection = await call('integrationAdd', {
                    name: 'Linear',
                    provider: 'linear',
                    url: 'https://mcp.linear.app/mcp/readonly',
                    auth: 'oauth',
                  });
                  await call('integrationConnect', { connectionId: connection.id });
                  setIntegrations(await call('integrations'));
                  setBusy(false);
                })
              }
            >
              <Plug size={15} /> Connect Linear
            </button>
          </section>
          {integrations.map((connection) => (
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
          <CustomServerForm
            customServer={customServer}
            setCustomServer={setCustomServer}
            action={action}
            call={call}
            setIntegrations={setIntegrations}
            setNotice={setNotice}
          />
        </div>
      )}
      <PreferenceSettings {...props} />
      {settingsTab === 'desktop' && (
        <DesktopUpdateSettings
          updateStatus={updateStatus}
          updatePreferences={updatePreferences}
          saveUpdatePreferences={saveUpdatePreferences}
          api={api}
          setUpdateStatus={setUpdateStatus}
          busy={busy}
        />
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
