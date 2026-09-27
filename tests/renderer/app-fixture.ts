import { vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import type {
  Baseline,
  McpConnection,
  Project,
  RunEvent,
  RunManifest,
} from '../../packages/contracts/src/index';
import { estimateFixture, report } from './fixtures';

export function appFixture() {
  let project: Project;
  let baseline: Baseline | null;
  let runs: RunManifest[];
  let estimate = estimateFixture();
  let connections: McpConnection[] = [];
  let listener: ((event: RunEvent) => void) | undefined;
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
          product: report.baseline,
          reviewedAt: report.generatedAt,
          retiredIds: [],
        }
      : null;
    runs = [
      {
        id: ready ? report.id : 'review-run',
        projectId: project.id,
        project,
        kind: ready ? 'report' : 'prepare',
        status: ready ? 'completed' : 'review',
        stage: ready ? 'complete' : 'review',
        createdAt: report.generatedAt,
      },
    ];
    estimate = estimateFixture();
    connections = [];
    listener = undefined;
  }
  reset();
  const request = vi.fn((method: string, p: any = {}) =>
    Promise.resolve().then(() => {
      switch (method) {
        case 'projects':
          return [project];
        case 'diagnostics':
          return [
            { provider: 'codex', installed: true, ready: true, subscription: true, apiKey: false },
          ];
        case 'models':
          return [{ id: 'synthetic', label: 'Synthetic model', isDefault: true }];
        case 'state':
          return { project, baseline, runs };
        case 'candidate':
          return report.baseline;
        case 'result':
          return report;
        case 'estimation':
          return estimate;
        case 'integrations':
          return connections;
        case 'discoverRepositories':
          return {
            rootPath: '/synthetic',
            warnings: ['Synthetic discovery warning'],
            repositories: project.repositories,
          };
        case 'prepare':
          project = p.project;
          return { runId: 'prepare-run' };
        case 'approve':
          baseline = {
            id: 'approved',
            projectId: project.id,
            contextHash: 'a'.repeat(64),
            product: p.product,
            reviewedAt: report.generatedAt,
            retiredIds: [],
          };
          return baseline;
        case 'report':
        case 'resume':
          return { runId: 'analysis-run' };
        case 'estimate':
          return { runId: 'estimate-run' };
        case 'cancel':
          return { cancelled: true };
        case 'answer':
          return { accepted: true };
        case 'updateRuntime':
          project = { ...project, runtime: p.runtime };
          return null;
        case 'updateSources':
          project = { ...project, sources: p.sources };
          return null;
        case 'estimateOverrides':
          return estimate;
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
    getSchedules: vi.fn().mockResolvedValue([]),
    setSchedule: vi.fn().mockImplementation((projectId: string, config: unknown) =>
      Promise.resolve({
        ...(config as object),
        projectId,
        nextRunAt: '2026-10-01T09:00:00.000Z',
      }),
    ),
  };
  window.aiden = api as unknown as DesktopBridge;
  return {
    api,
    request,
    reset,
    emit: (event: RunEvent) => listener!(event),
    project: () => project,
    addInterruptedRun: () => {
      runs.push({ ...runs[0]!, id: 'interrupted-run', status: 'cancelled', stage: 'assess' });
    },
    setEstimate: (value: typeof estimate) => {
      estimate = value;
    },
  };
}
