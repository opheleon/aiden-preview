import type { BetaSettings, CodingJob } from './delivery-jobs.js';
import type {
  DeviceRun,
  DeviceTarget,
  DeviceTest,
  ProjectDeviceTest,
} from './device-verification.js';
import type { GuideView, SetupStepId } from './guide.js';
import type {
  ActivityEntry,
  Baseline,
  Call,
  ChatMessage,
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
  VerificationResult,
  VerificationSettings,
} from './index.js';
import type { PhoneApp, PhoneReadiness, PhoneSetup } from './phone-setup.js';
import type { LinearTeam, TicketSettings, TicketState } from './tickets.js';
import type { VerificationUpdate } from './verification.js';
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
export type RuntimeModel = {
  id: string;
  label: string;
  isDefault?: boolean;
  /** Canonical provider model behind an alias, when advertised. */
  resolvedModel?: string;
  /** Account-advertised effort choices; an empty list means unsupported. */
  supportedEfforts?: RuntimeConfig['effort'][];
};
type ProjectRef = { projectId: string };
type RunRef = ProjectRef & { runId: string };
/** Allowlisted desktop and CLI operations with stable request/result contracts across the worker boundary. */
export type WorkerAPI = {
  phoneSetup: { params: Record<string, never>; result: PhoneReadiness };
  savePhoneSetup: { params: PhoneSetup; result: PhoneSetup };
  phoneApps: { params: { udid: string }; result: PhoneApp[] };
  deviceProbe: { params: DeviceTarget; result: Record<string, string> };
  deviceTest: { params: DeviceTest; result: { runId: string } };
  deviceRuns: { params: Record<string, never>; result: DeviceRun[] };
  deviceRun: { params: { runId: string }; result: DeviceRun | null };
  deviceCancel: { params: { runId: string }; result: { cancelled: boolean } };
  discoverRepositories: { params: { rootPath: string }; result: RepositoryDiscovery };
  /** Record human acceptance of the currently displayed scope and evidence. */
  acceptOutcome: { params: ProjectRef & { note: string; evidenceKey: string }; result: Project };
  /** Pause project monitoring while retaining evidence and external tracker state. */
  closeProject: {
    params: ProjectRef & { note?: string; forgetCredentials?: boolean };
    result: Project;
  };
  /** Resume monitoring for a closed project. */
  reopenProject: { params: ProjectRef; result: Project };
  projects: { params: Record<string, never>; result: Project[] };
  state: {
    params: ProjectRef;
    /** `activeRunIds` names runs this worker is executing; other running manifests were interrupted. */
    result: {
      project: Project;
      baseline: Baseline | null;
      runs: RunManifest[];
      activeRunIds: string[];
    };
  };
  /** With `autoAccept`, Aiden commits what done means itself and then looks, instead of stopping for review. */
  prepare: {
    params: { project: Project; autoAccept?: boolean; verification?: VerificationUpdate };
    result: { runId: string };
  };
  approve: { params: RunRef & { product: Product }; result: Baseline };
  /** `browserCheck` also checks the saved app URL in a browser once the assessment is accepted. */
  report: { params: ProjectRef & { browserCheck?: boolean }; result: { runId: string } };
  resume: { params: RunRef; result: { runId: string } };
  cancel: { params: { runId: string }; result: { cancelled: boolean } };
  waitForRun: { params: { runId: string }; result: null };
  /**
   * Assess repository code against what done means, optionally check the installed phone build,
   * then estimate remaining work. Device criteria and provider selection come from the accepted report.
   */
  look: {
    params: ProjectRef & {
      reason?: 'commit' | 'morning' | 'ticket';
      device?: ProjectDeviceTest;
      verifySurfaces?: boolean;
    };
    result: { runId: string };
  };
  /** Everything Aiden did on the project, newest first. */
  activity: { params: ProjectRef; result: ActivityEntry[] };
  /** Manual tests marked done: action item key to the report they were done against. */
  confirmations: { params: ProjectRef; result: Record<string, string> };
  /** Mark a manual test done against a report; it is due again after the next look. */
  confirmAction: {
    params: ProjectRef & { key: string; reportId: string };
    result: Record<string, string>;
  };
  /** One run's full history, oldest first, including every step it took. */
  runLog: { params: RunRef; result: ActivityEntry[] };
  /** A run's "Why?" conversation, oldest first. */
  chat: { params: RunRef; result: ChatMessage[] };
  /** Explain one action-log line, from the reason recorded at the time when there is one. */
  explain: { params: RunRef & { at: string; summary: string }; result: ChatMessage[] };
  /** Ask about a run; answered from its saved record with the project's runtime and billing. */
  askWhy: { params: RunRef & { question: string }; result: ChatMessage[] };
  /** The project's Guide conversation and the setup checklist derived from saved project state. */
  guide: { params: ProjectRef; result: GuideView };
  /**
   * Talk to the project's Guide with its runtime and billing. `kickoff` asks it to play back the
   * requirements; `retry` answers the last unanswered message again; otherwise `text` is required.
   */
  askGuide: {
    params: ProjectRef & {
      text?: string;
      kickoff?: boolean;
      retry?: boolean;
      clarification?: { callId: string; answer: string };
    };
    result: GuideView;
  };
  /** Record an app fact in the Guide thread, such as a saved URL, so the Guide knows about it. */
  guideEvent: { params: ProjectRef & { text: string }; result: GuideView };
  /** Mark the current requirements as confirmed by the person. */
  confirmRequirements: { params: ProjectRef; result: GuideView };
  /** Skip an optional or deferrable setup step. */
  skipSetupStep: { params: ProjectRef & { step: SetupStepId }; result: GuideView };
  /** Check that an app URL answers, without opening a browser or running any check. */
  testAppUrl: { params: { url: string }; result: { reachable: boolean; message: string } };
  /** Check every selected target and optionally save only after all access checks succeed. */
  configureGuideVerification: {
    params: ProjectRef & { update: VerificationUpdate; save: boolean; code?: Project };
    result: { message: string };
  };
  /** Every call recorded for the project, oldest first. */
  calls: { params: ProjectRef; result: Call[] };
  /** Answer a call; `runId` is the work it started, or null when Aiden uses it on the next look. */
  answerCall: {
    params: ProjectRef & { callId: string; answer: string };
    result: { call: Call; runId: string | null };
  };
  /** Change the intent sentence or what done means; Aiden then looks again. */
  editIntent: {
    params: ProjectRef & ({ context: string } | { product: Product });
    result: { runId: string };
  };
  /**
   * Selected remote-branch commits, read without changing local refs. `changed` means a commit differs from the
   * last look; `ready` means what done means exists; `active` means Aiden is already working;
   * `lastLookAt` is when the last look started.
   */
  /** Project-scoped monitored branches and live remote choices. */
  monitoring: { params: ProjectRef; result: Project };
  remoteBranches: {
    params: ProjectRef & { repositoryId: string };
    result: { branches: { remote: string; branch: string }[]; warnings: string[] };
  };
  updateMonitoredBranch: {
    params: ProjectRef & {
      repositoryId: string;
      monitoredBranch: { remote: string; branch: string };
    };
    result: Project;
  };
  heads: {
    params: ProjectRef;
    result: {
      repositories: { repositoryId: string; sha: string | null }[];
      active: boolean;
      changed: boolean;
      ready: boolean;
      lastLookAt: string | null;
    };
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
  login: { params: { provider: 'codex' | 'claude' }; result: { authUrl?: string } };
  updateRuntime: { params: ProjectRef & { runtime: RuntimeConfig }; result: null };
  integrations: { params: Record<string, never>; result: McpConnection[] };
  integrationPreset: { params: { provider: 'linear' | 'jira' }; result: McpConnection };
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
  connectCode: {
    params: ProjectRef & {
      code: Pick<Project, 'rootPath' | 'additionalRootPaths' | 'repositories'>;
    };
    result: { runId: string | null };
  };
  estimate: {
    params: ProjectRef & { reportId?: string; refreshHistory?: boolean };
    result: { runId: string };
  };
  estimation: { params: ProjectRef; result: EstimationSnapshot | null };
  estimateOverrides: {
    params: ProjectRef & { overrides: EstimateOverrides };
    result: EstimationSnapshot;
  };
  linearTeams: { params: { connectionId: string }; result: LinearTeam[] };
  publishLinearTickets: {
    params: ProjectRef & {
      connectionId: string;
      teamId: string;
      fingerprint: string;
      tools: TicketSettings['tools'];
    };
    result: TicketState;
  };
  ticketState: { params: ProjectRef; result: TicketState };
  ticketCapabilities: {
    params: { connectionId: string; provider: 'linear' | 'jira' };
    result: Pick<TicketSettings, 'tools' | 'fingerprint'>;
  };
  saveTicketSettings: { params: ProjectRef & { settings: TicketSettings }; result: TicketState };
  syncTickets: { params: ProjectRef; result: TicketState };
  codingJobs: { params: ProjectRef; result: CodingJob[] };
  startCoding: {
    params: ProjectRef & { repositoryId: string; instruction: string };
    result: CodingJob;
  };
  cancelCoding: { params: ProjectRef & { jobId: string }; result: null };
  reconcileDelivery: { params: ProjectRef; result: CodingJob[] };
  betaSettings: { params: ProjectRef; result: BetaSettings };
  updateBetaSettings: { params: ProjectRef & { settings: BetaSettings }; result: BetaSettings };
  verify: { params: ProjectRef & { url?: string }; result: { runId: string } };
  verificationSettings: { params: ProjectRef; result: VerificationSettings };
  updateVerificationSettings: {
    params: ProjectRef & VerificationUpdate;
    result: VerificationSettings;
  };
  verification: {
    params: ProjectRef & { runId?: string };
    result: { result: VerificationResult; reportPath: string } | null;
  };
};
/** Only these operation names may cross the trusted worker dispatch boundary. */
export type WorkerMethod = keyof WorkerAPI;
/** Request shape tied to its operation name; runtime validation remains mandatory at dispatch. */
export type WorkerParams<K extends WorkerMethod> = WorkerAPI[K]['params'];
/** Response shape tied to its operation name so callers cannot mix unrelated payloads. */
export type WorkerResult<K extends WorkerMethod> = WorkerAPI[K]['result'];
