import { useState } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api.js';
import type { RuntimeDiagnostic } from '../../../../packages/contracts/src/api.js';
import type {
  Baseline,
  EstimateOverrides,
  EstimationSnapshot,
  McpConnection,
  McpTool,
  Product,
  Project,
  Report,
  RunEvent,
  RunManifest,
} from '../../../../packages/contracts/src/index';
import { defaultOverrides } from '../../../../packages/estimation/src/index';
import { newProject } from '../renderer/project-state';
import type { UpdatePreferences, UpdateStatus } from '../updater';

/** Own project artifacts and current run presentation. */
function useProjectState() {
  const [project, setProject] = useState<Project>(newProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [step, setStep] = useState(0);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [activeRun, setActiveRun] = useState('');
  const [reviewRun, setReviewRun] = useState('');
  const [product, setProduct] = useState<Product>();
  const [baseline, setBaseline] = useState<Baseline>();
  const [report, setReport] = useState<Report>();
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [question, setQuestion] = useState<RunEvent>();
  const [answer, setAnswer] = useState('');
  const [evidence, setEvidence] = useState<WorkerResult<'evidence'>>();
  const [notice, setNotice] = useState('');
  const [verification, setVerification] = useState<WorkerResult<'verification'>>(null);
  return {
    project,
    setProject,
    projects,
    setProjects,
    step,
    setStep,
    diagnostics,
    setDiagnostics,
    busy,
    setBusy,
    scanning,
    setScanning,
    error,
    setError,
    log,
    setLog,
    activeRun,
    setActiveRun,
    reviewRun,
    setReviewRun,
    product,
    setProduct,
    baseline,
    setBaseline,
    report,
    setReport,
    runs,
    setRuns,
    question,
    setQuestion,
    answer,
    setAnswer,
    evidence,
    setEvidence,
    notice,
    setNotice,
    verification,
    setVerification,
  };
}

/** Own navigation and desktop preference presentation. */
function usePreferenceState() {
  const [area, setArea] = useState<'projects' | 'drafts' | 'settings'>('projects');
  const [settingsTab, setSettingsTab] = useState<
    'model' | 'schedule' | 'integrations' | 'preferences' | 'desktop'
  >('integrations');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [updatePreferences, setUpdatePreferences] = useState<UpdatePreferences>({
    autoDownload: true,
    channel: 'stable',
  });
  const [integrations, setIntegrations] = useState<McpConnection[]>([]);
  const [integrationTools, setIntegrationTools] = useState<Record<string, McpTool[]>>({});
  const [estimation, setEstimation] = useState<EstimationSnapshot>();
  const [overrides, setOverrides] = useState<EstimateOverrides>(defaultOverrides());
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
    estimation,
    setEstimation,
    overrides,
    setOverrides,
  };
}

/** Own unsaved integration and history-source inputs. */
function useSourceState() {
  const [customServer, setCustomServer] = useState({
    name: '',
    url: '',
    auth: 'oauth' as 'oauth' | 'bearer' | 'none',
    bearer: '',
    clientId: '',
    sessionOnly: false,
  });
  const [historyDraft, setHistoryDraft] = useState({
    connectionId: '',
    sourceId: '',
    sourceLabel: '',
    historyTool: '',
    sourceArgument: 'team',
  });
  const [contextConnectionIds, setContextConnectionIds] = useState<string[]>([]);
  const [discoveredSources, setDiscoveredSources] = useState<unknown>();
  const [showHistoryConfig, setShowHistoryConfig] = useState(false);
  const [showGoalStarter, setShowGoalStarter] = useState(true);
  return {
    customServer,
    setCustomServer,
    historyDraft,
    setHistoryDraft,
    contextConnectionIds,
    setContextConnectionIds,
    discoveredSources,
    setDiscoveredSources,
    showHistoryConfig,
    setShowHistoryConfig,
    showGoalStarter,
    setShowGoalStarter,
  };
}

/** Mutable workspace presentation state, separate from worker and desktop side effects. */
export type WorkspaceState = ReturnType<typeof useProjectState> &
  ReturnType<typeof usePreferenceState> &
  ReturnType<typeof useSourceState>;
/** Compose project, preference, and source state with stable React setters. */
export function useWorkspaceState(): WorkspaceState {
  return { ...useProjectState(), ...usePreferenceState(), ...useSourceState() };
}
