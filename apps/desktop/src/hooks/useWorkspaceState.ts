import { useState } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api.js';
import type { RuntimeDiagnostic } from '../../../../packages/contracts/src/api.js';
import type {
  ActivityEntry,
  Baseline,
  Call,
  McpConnection,
  McpTool,
  Project,
  Report,
  RunManifest,
} from '../../../../packages/contracts/src/index';
import { newProject } from '../renderer/project-state';
import type { UpdatePreferences, UpdateStatus } from '../updater';

/** Where the main window is: a project's brief, or settings. */
export type Area = 'projects' | 'runs' | 'settings';
/** Settings tabs; the project tab holds everything specific to the selected project. */
export type SettingsTab = 'project' | 'model' | 'integrations' | 'preferences' | 'desktop';

/** Own the selected project and what Aiden knows about it. */
function useProjectState() {
  const [project, setProject] = useState<Project>(newProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [live, setLive] = useState('');
  /** The latest step of each run this window has seen, for live run lists. */
  const [liveByRun, setLiveByRun] = useState<Record<string, string>>({});
  /** Runs the worker is executing for this project right now. */
  const [activeRuns, setActiveRuns] = useState<string[]>([]);
  /** The run open in the runs view; empty shows the list. */
  const [openRun, setOpenRun] = useState('');
  const [activeRun, setActiveRun] = useState('');
  const [baseline, setBaseline] = useState<Baseline>();
  const [report, setReport] = useState<Report>();
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  /** Manual tests marked done: action item key to the report they were done against. */
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<WorkerResult<'evidence'>>();
  const [notice, setNotice] = useState('');
  const [verification, setVerification] = useState<WorkerResult<'verification'>>(null);
  return {
    project,
    setProject,
    projects,
    setProjects,
    diagnostics,
    setDiagnostics,
    busy,
    setBusy,
    scanning,
    setScanning,
    error,
    setError,
    live,
    setLive,
    liveByRun,
    setLiveByRun,
    openRun,
    setOpenRun,
    activeRuns,
    setActiveRuns,
    activeRun,
    setActiveRun,
    baseline,
    setBaseline,
    report,
    setReport,
    runs,
    setRuns,
    activity,
    setActivity,
    calls,
    setCalls,
    confirmed,
    setConfirmed,
    evidence,
    setEvidence,
    notice,
    setNotice,
    verification,
    setVerification,
  };
}

/** Own navigation, desktop preferences, and integration inputs. */
function usePreferenceState() {
  const [area, setArea] = useState<Area>('projects');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('project');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [updatePreferences, setUpdatePreferences] = useState<UpdatePreferences>({
    autoDownload: true,
    channel: 'stable',
  });
  const [integrations, setIntegrations] = useState<McpConnection[]>([]);
  const [integrationTools, setIntegrationTools] = useState<Record<string, McpTool[]>>({});
  const [customServer, setCustomServer] = useState({
    name: '',
    url: '',
    auth: 'oauth' as 'oauth' | 'bearer' | 'none',
    bearer: '',
    clientId: '',
    sessionOnly: false,
  });
  return {
    area,
    setArea,
    settingsTab,
    setSettingsTab,
    updateStatus,
    setUpdateStatus,
    updatePreferences,
    setUpdatePreferences,
    integrations,
    setIntegrations,
    integrationTools,
    setIntegrationTools,
    customServer,
    setCustomServer,
  };
}

/** Mutable workspace presentation state, separate from worker and desktop side effects. */
export type WorkspaceState = ReturnType<typeof useProjectState> &
  ReturnType<typeof usePreferenceState>;
/** Compose project and preference state with stable React setters. */
export function useWorkspaceState(): WorkspaceState {
  return { ...useProjectState(), ...usePreferenceState() };
}
