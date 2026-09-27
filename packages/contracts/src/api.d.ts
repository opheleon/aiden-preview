import type {
  Baseline,
  EstimateOverrides,
  EstimationSnapshot,
  Evidence,
  McpAuth,
  McpConnection,
  McpTool,
  Product,
  Project,
  ProjectSources,
  Report,
  RepositoryDiscovery,
  RunManifest,
  RuntimeConfig,
} from './index.js';
/** Coarse sign-in state safe to show without exposing provider account identifiers. */
export type SubscriptionState =
  'authenticated' | 'sign_in_required' | 'unavailable' | 'check_failed';
/** Provider availability and selected credential-source readiness, without raw provider output. */
export type RuntimeDiagnostic = {
  provider: 'codex' | 'claude';
  installed: boolean;
  ready: boolean;
  subscription: boolean;
  subscriptionState?: SubscriptionState;
  apiKey: boolean;
  version?: string;
  message?: string;
};
/** Account-advertised model option; the default flag comes from the provider rather than a hardcoded alias. */
export type RuntimeModel = { id: string; label: string; isDefault?: boolean };
type ProjectRef = { projectId: string };
type RunRef = ProjectRef & { runId: string };
/** Allowlisted desktop and CLI operations with stable request/result contracts across the worker boundary. */
export type WorkerAPI = {
  discoverRepositories: { params: { rootPath: string }; result: RepositoryDiscovery };
  projects: { params: Record<string, never>; result: Project[] };
  state: {
    params: ProjectRef;
    result: { project: Project; baseline: Baseline | null; runs: RunManifest[] };
  };
  prepare: { params: { project: Project }; result: { runId: string } };
  approve: { params: RunRef & { product: Product }; result: Baseline };
  report: { params: ProjectRef; result: { runId: string } };
  resume: { params: RunRef; result: { runId: string } };
  cancel: { params: { runId: string }; result: { cancelled: boolean } };
  waitForRun: { params: { runId: string }; result: null };
  answer: {
    params: { runId: string; questionId: string; answer: string };
    result: { accepted: boolean };
  };
  candidate: { params: RunRef; result: Product };
  result: { params: ProjectRef & { runId?: string }; result: Report };
  export: {
    params: RunRef & { format: 'json' | 'markdown'; includeEstimates?: boolean };
    result: string;
  };
  evidence: {
    params: RunRef & { index: number; evidenceIndex: number };
    result: Evidence & { text: string };
  };
  diagnostics: { params: Record<string, never>; result: RuntimeDiagnostic[] };
  models: { params: { runtime: RuntimeConfig }; result: RuntimeModel[] };
  setKey: { params: { provider: 'codex' | 'claude'; key: string }; result: { saved: string } };
  login: { params: { provider: 'codex' }; result: { authUrl?: string } };
  updateRuntime: { params: ProjectRef & { runtime: RuntimeConfig }; result: null };
  integrations: { params: Record<string, never>; result: McpConnection[] };
  integrationAdd: {
    params: {
      name: string;
      provider: 'linear' | 'custom';
      url: string;
      auth: McpAuth;
      bearer?: string;
      clientId?: string;
      sessionOnly?: boolean;
    };
    result: McpConnection;
  };
  integrationConnect: {
    params: { connectionId: string };
    result: { connection: McpConnection; authUrl?: string };
  };
  integrationTools: { params: { connectionId: string }; result: McpTool[] };
  integrationApprove: {
    params: { connectionId: string; tools: string[]; fingerprint: string };
    result: McpConnection;
  };
  integrationCall: {
    params: { connectionId: string; tool: string; arguments: Record<string, unknown> };
    result: { result: unknown; receipt: unknown };
  };
  integrationDisconnect: { params: { connectionId: string }; result: McpConnection };
  integrationRemove: { params: { connectionId: string }; result: { removed: boolean } };
  updateSources: { params: ProjectRef & { sources: ProjectSources }; result: null };
  estimate: {
    params: ProjectRef & { reportId?: string; refreshHistory?: boolean };
    result: { runId: string };
  };
  estimation: { params: ProjectRef; result: EstimationSnapshot | null };
  estimateOverrides: {
    params: ProjectRef & { overrides: EstimateOverrides };
    result: EstimationSnapshot;
  };
};
/** Only these operation names may cross the trusted worker dispatch boundary. */
export type WorkerMethod = keyof WorkerAPI;
/** Request shape tied to its operation name; runtime validation remains mandatory at dispatch. */
export type WorkerParams<K extends WorkerMethod> = WorkerAPI[K]['params'];
/** Response shape tied to its operation name so callers cannot mix unrelated payloads. */
export type WorkerResult<K extends WorkerMethod> = WorkerAPI[K]['result'];
