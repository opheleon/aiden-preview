import { vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import type { WorkerResult } from '../../packages/contracts/src/api';
import type {
  ActivityEntry,
  Baseline,
  Call,
  ChatMessage,
  CodingJob,
  McpConnection,
  Project,
  Report,
  RunEvent,
  RunManifest,
} from '../../packages/contracts/src/index';
import type { TicketState } from '../../packages/contracts/src/tickets';
import { report } from './fixtures';

/** An open call as the worker would return it; synthetic, not recorded agent output. */
export function openCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    kind: 'decision',
    status: 'open',
    requirementId: 'REQ-2',
    edgeCaseId: null,
    question: 'Can two books share a title?',
    options: ['Allow duplicates', 'Block duplicates'],
    assumption: 'Allow duplicates',
    owner: 'you',
    answer: null,
    askedAt: report.generatedAt,
    answeredAt: null,
    runId: report.id,
    ...overrides,
  };
}

export function appFixture() {
  let project: Project;
  let tickets: TicketState = { settings: null, records: [] };
  let baseline: Baseline | null;
  let runs: RunManifest[];
  let current: Report = report;
  let calls: Call[] = [];
  let activity: ActivityEntry[] = [];
  let chats: Record<string, ChatMessage[]> = {};
  let runLogs: Record<string, ActivityEntry[]> = {};
  let confirmed: Record<string, string> = {};
  let connections: McpConnection[] = [];
  let appUrl: string | null = null;
  let verification: WorkerResult<'verification'> = null;
  let listener: ((event: RunEvent) => void) | undefined;
  // Runs this fixture's worker started; runs added by other processes stay out of activeRunIds.
  let active = new Set<string>();
  /** Record a run the desktop worker is executing and return its start result. */
  const start = (runId: string) => {
    active.add(runId);
    return { runId };
  };
  const tools = [
    {
      name: 'list_issues',
      description: 'Read completed issues',
      readOnly: true,
      approved: true,
      inputSchema: { type: 'object' },
      reason: 'Read operation',
    },
    {
      name: 'delete_issue',
      description: 'Deletes issues',
      readOnly: false,
      approved: false,
      inputSchema: { type: 'object' },
      reason: 'Writes are blocked',
    },
  ];
  /** Restore the saved project; `ready: false` is a project whose first rewrite is still running. */
  function reset(ready = true) {
    project = {
      id: report.projectId,
      name: 'Synthetic books',
      context: 'Users can list and create books',
      rootPath: '/synthetic',
      repositories: [{ id: 'frontend', path: '/synthetic/frontend', notes: 'main' }],
      runtime: { provider: 'codex', auth: 'subscription' },
    };
    baseline = ready
      ? {
          id: report.baselineId,
          projectId: project.id,
          contextHash: 'a'.repeat(64),
          product: { ...report.baseline, title: 'Synthetic books' },
          reviewedAt: report.generatedAt,
          retiredIds: [],
        }
      : null;
    runs = [
      {
        id: ready ? report.id : 'prepare-run',
        projectId: project.id,
        project,
        kind: ready ? 'report' : 'prepare',
        status: ready ? 'completed' : 'running',
        stage: ready ? 'complete' : 'understand',
        createdAt: report.generatedAt,
      },
    ];
    current = report;
    tickets = { settings: null, records: [] };
    calls = [];
    activity = [];
    chats = {};
    runLogs = {};
    confirmed = {};
    connections = [];
    appUrl = null;
    verification = null;
    listener = undefined;
    active = new Set(ready ? [] : ['prepare-run']);
  }
  reset();
  const request = vi.fn((method: string, p: any = {}) =>
    Promise.resolve().then(() => {
      switch (method) {
        case 'codingJobs':
        case 'reconcileDelivery':
          return [] as CodingJob[];
        case 'betaSettings':
          return { enabled: false, intervalMinutes: 60 };
        case 'estimation':
          return null;
        case 'projects':
          return [project];
        case 'diagnostics':
          return [
            { provider: 'codex', installed: true, ready: true, subscription: true, apiKey: false },
          ];
        case 'models':
          return [{ id: 'synthetic', label: 'Synthetic model', isDefault: true }];
        case 'monitoring':
          return project;
        case 'remoteBranches':
          return {
            branches: [
              { remote: 'origin', branch: 'main' },
              { remote: 'origin', branch: 'release' },
            ],
            warnings: [],
          };
        case 'updateMonitoredBranch':
          project = {
            ...project,
            repositories: project.repositories.map((repo) =>
              repo.id === p.repositoryId ? { ...repo, monitoredBranch: p.monitoredBranch } : repo,
            ),
          };
          return project;
        case 'state':
          return { project, baseline, runs, activeRunIds: [...active] };
        case 'result':
          return current;
        case 'calls':
          return calls;
        case 'activity':
          return activity;
        case 'look':
          return start('look-run');
        case 'answerCall': {
          const call = calls.find((c) => c.id === p.callId)!;
          const answered = { ...call, status: 'answered' as const, answer: p.answer };
          calls = calls.map((c) => (c.id === p.callId ? answered : c));
          return {
            call: answered,
            runId: call.kind === 'app-url' ? null : start('answer-run').runId,
          };
        }
        case 'editIntent':
          return start('intent-run');
        case 'chat':
          return chats[p.runId] ?? [];
        case 'confirmations':
          return confirmed;
        case 'confirmAction':
          confirmed = { ...confirmed, [p.key]: p.reportId };
          return confirmed;
        case 'runLog':
          return runLogs[p.runId] ?? [];
        case 'explain': {
          const entry = [...activity, ...(runLogs[p.runId] ?? [])].find(
            (e) => e.at === p.at && e.summary === p.summary,
          );
          chats[p.runId] = [
            ...(chats[p.runId] ?? []),
            { at: report.generatedAt, from: 'you', text: `Why: ${p.summary}` },
            {
              at: report.generatedAt,
              from: 'aiden',
              text: entry?.reason ?? 'Synthetic model answer.',
              ...(entry?.reason ? { source: 'log' } : { source: 'model' }),
            },
          ];
          return chats[p.runId];
        }
        case 'askWhy':
          if (p.question === 'fail') throw new Error('Aiden could not answer.');
          chats[p.runId] = [
            ...(chats[p.runId] ?? []),
            { at: report.generatedAt, from: 'you', text: p.question },
            {
              at: report.generatedAt,
              from: 'aiden',
              text: 'Synthetic answer from the run record.',
              source: 'model',
            },
          ];
          return chats[p.runId];
        case 'ticketState':
          return tickets;
        case 'integrations':
          return connections;
        case 'verificationSettings':
          return { url: appUrl };
        case 'updateVerificationSettings':
          if (p.url?.startsWith('file:'))
            throw new Error('Only http and https URLs can be verified.');
          appUrl = p.url;
          return { url: appUrl };
        case 'verify':
          runs.push({
            ...runs[0]!,
            id: 'verify-run',
            kind: 'verify',
            status: 'running',
            stage: 'verify',
          });
          return start('verify-run');
        case 'verification':
          return verification;
        case 'discoverRepositories':
          return {
            rootPath: '/synthetic',
            warnings: ['Synthetic discovery warning'],
            repositories: project.repositories,
          };
        case 'prepare':
          project = p.project;
          baseline = null;
          runs = [];
          return start('prepare-run');
        case 'cancel':
          active.delete(p.runId);
          runs = runs.map((r) => (r.id === p.runId ? { ...r, status: 'cancelled' as const } : r));
          return { cancelled: true };
        case 'updateRuntime':
          project = { ...project, runtime: p.runtime };
          return null;
        case 'updateSources':
          project = { ...project, sources: p.sources };
          return null;
        case 'evidence':
          return {
            ...report.assessments[p.index]!.evidence[p.evidenceIndex]!,
            text: 'GET /books\nrender list',
          };
        case 'integrationAdd': {
          const connection: McpConnection = {
            id: `connection-${connections.length}`,
            name: p.name,
            provider: p.provider,
            url: p.url,
            auth: p.auth,
            transport: 'streamable-http',
            secureStorage: 'session',
            status: 'disconnected',
            approvedTools: [],
            createdAt: report.generatedAt,
            updatedAt: report.generatedAt,
          };
          connections = [...connections, connection];
          return connection;
        }
        case 'integrationConnect':
          connections = connections.map((c) => ({
            ...c,
            status: 'connected',
            toolFingerprint: 'reviewed-tools',
          }));
          return { connection: connections[0] };
        case 'integrationTools':
          return tools;
        case 'integrationApprove':
          return connections[0];
        case 'integrationCall':
          return { result: { teams: [{ id: 'team', name: 'Synthetic team' }] }, receipt: {} };
        case 'integrationDisconnect':
          connections = connections.map((c) => ({ ...c, status: 'disconnected' }));
          return connections[0];
        case 'integrationRemove':
          connections = [];
          return { removed: true };
        default:
          throw new Error(`Unexpected fixture operation: ${method}`);
      }
    }),
  );
  const api = {
    request,
    onEvent: (callback: (event: RunEvent) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    getUpdateStatus: vi.fn().mockResolvedValue({
      state: 'disabled',
      currentVersion: '1.1.0',
      latestVersion: null,
      progress: null,
      error: null,
      message: null,
      lastCheckedAt: null,
    }),
    getUpdatePreferences: vi.fn().mockResolvedValue({ autoDownload: true, channel: 'stable' }),
    setUpdatePreferences: vi.fn().mockImplementation((value: unknown) => Promise.resolve(value)),
    onUpdateStatus: () => () => {},
    chooseProjectFolder: vi.fn().mockResolvedValue('/synthetic'),
    chooseContext: vi.fn().mockResolvedValue('Imported fixture intent'),
    openExternal: vi.fn().mockResolvedValue(undefined),
    saveExport: vi.fn().mockResolvedValue(true),
    openVerificationReport: vi.fn().mockResolvedValue(undefined),
    verificationMedia: vi.fn().mockResolvedValue({ type: 'video/webm', data: new ArrayBuffer(8) }),
  };
  window.aiden = api as unknown as DesktopBridge;
  return {
    api,
    request,
    reset,
    emit: (event: RunEvent) => listener!(event),
    project: () => project,
    /** Add a newer saved run, such as a look that failed after the last brief. */
    addRun: (run: Partial<RunManifest> & Pick<RunManifest, 'id' | 'kind' | 'status'>) => {
      runs = [
        { ...runs[0]!, stage: 'discover', createdAt: '2026-09-30T00:00:00.000Z', ...run },
        ...runs,
      ];
    },
    /** Add a run the worker is executing now, with its history so far. */
    startRun: (
      run: Partial<RunManifest> & Pick<RunManifest, 'id' | 'kind'>,
      log: ActivityEntry[],
    ) => {
      runs = [
        { ...runs[0]!, status: 'running', stage: 'assess', createdAt: report.generatedAt, ...run },
        ...runs,
      ];
      active.add(run.id);
      runLogs[run.id] = log;
    },
    /** Drop saved runs, so the project has what done means but no finished look. */
    clearRuns: () => {
      runs = [];
    },
    addVerificationRun: (status: RunManifest['status']) => {
      runs.push({ ...runs[0]!, id: 'verify-run', kind: 'verify', status, stage: 'verify' });
    },
    setVerification: (value: WorkerResult<'verification'>) => {
      verification = value;
    },
    setReport: (value: Report) => {
      current = value;
    },
    setTickets: (value: TicketState) => {
      tickets = value;
    },
    setCalls: (value: Call[]) => {
      calls = value;
    },
    setActivity: (value: ActivityEntry[]) => {
      activity = value;
    },
    setBaseline: (value: Baseline | null) => {
      baseline = value;
    },
  };
}
