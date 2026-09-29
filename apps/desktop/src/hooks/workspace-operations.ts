import type { RunManifest } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import { overridesFrom } from '../renderer/project-state';
import type { WorkspaceState } from './useWorkspaceState';

/** Surface user-operation failures and release busy state for a recoverable retry. */
async function action(state: WorkspaceState, fn: () => Promise<void>): Promise<void> {
  state.setError('');
  try {
    await fn();
  } catch (e) {
    state.setError(e instanceof Error ? e.message : 'Something went wrong.');
    state.setBusy(false);
  }
}

/** Load a saved project, pending review, and accepted artifacts without restarting interrupted work. */
async function load(
  state: WorkspaceState,
  call: DesktopBridge['request'],
  id: string,
): Promise<void> {
  await action(state, async () => {
    const s = await call('state', { projectId: id });
    state.setProject(s.project);
    state.setShowGoalStarter(false);
    state.setHistoryDraft(
      s.project.sources?.history
        ? { ...s.project.sources.history }
        : {
            connectionId: '',
            sourceId: '',
            sourceLabel: '',
            historyTool: '',
            sourceArgument: 'team',
          },
    );
    state.setContextConnectionIds(s.project.sources?.contextConnectionIds ?? []);
    state.setBaseline(s.baseline ?? undefined);
    state.setProduct(s.baseline?.product);
    state.setRuns(s.runs);
    // Only follow runs this worker is executing; a manifest left running by the CLI or an exited
    // worker never sends events here, so adopting it would show progress forever.
    const running = s.runs.find((run) => s.activeRunIds.includes(run.id));
    state.setActiveRun(running?.id ?? '');
    state.setBusy(!!running);
    state.setLog([]);
    state.setReport(undefined);
    const estimate = (await call('estimation', { projectId: id })) ?? undefined;
    state.setEstimation(estimate);
    state.setOverrides(overridesFrom(estimate));
    state.setVerification(
      await call('verification', { projectId: id }).catch((e: unknown) => {
        state.setError(e instanceof Error ? e.message : 'Could not load the last browser check.');
        return null;
      }),
    );
    state.setStep(s.baseline ? 3 : 0);
    state.setReviewRun('');
    const review = s.runs.find((r: RunManifest) => r.kind === 'prepare' && r.status === 'review');
    if (review && (!s.baseline || review.createdAt > s.baseline.reviewedAt)) {
      state.setProduct(await call('candidate', { projectId: id, runId: review.id }));
      state.setReviewRun(review.id);
      state.setStep(2);
    }
    const latest = s.runs.find((r: RunManifest) => r.status === 'completed' && r.kind === 'report');
    if (latest) state.setReport(await call('result', { projectId: id, runId: latest.id }));
    state.setArea('projects');
  });
}

/** Discover repositories while retaining existing notes and ignoring a replaced project. */
async function scanProjectFolder(
  state: WorkspaceState,
  call: DesktopBridge['request'],
  api: DesktopBridge | undefined,
  choose = false,
): Promise<void> {
  const projectId = state.project.id;
  await action(state, async () => {
    state.setScanning(true);
    try {
      const folder = choose ? await api?.chooseProjectFolder() : state.project.rootPath;
      if (!folder) return;
      const found = await call('discoverRepositories', { rootPath: folder });
      state.setProject((current) =>
        current.id !== projectId
          ? current
          : {
              ...current,
              rootPath: found.rootPath,
              discoveryWarnings: found.warnings,
              repositories: found.repositories.map(
                (repo) =>
                  current.repositories.find((existing) => existing.path === repo.path) ?? repo,
              ),
            },
      );
    } finally {
      state.setScanning(false);
    }
  });
}

/** Require complete project inputs before starting paid requirements preparation. */
async function prepare(state: WorkspaceState, call: DesktopBridge['request']): Promise<void> {
  await action(state, async () => {
    if (
      !state.project.name.trim() ||
      !state.project.context.trim() ||
      !state.project.repositories.length
    )
      throw new Error(
        'Add a project name, context, and a project folder containing a Git repository.',
      );
    state.setBusy(true);
    state.setLog([]);
    const r = await call('prepare', { project: state.project });
    state.setActiveRun(r.runId);
    state.setProjects(await call('projects'));
  });
}

/** Reject changed inputs until review, then assess the code and check the saved app URL, if any. */
async function analyze(state: WorkspaceState, call: DesktopBridge['request']): Promise<void> {
  await action(state, async () => {
    const saved = await call('state', { projectId: state.project.id });
    if (
      saved.project.context !== state.project.context ||
      saved.project.rootPath !== state.project.rootPath ||
      JSON.stringify(saved.project.discoveryWarnings) !==
        JSON.stringify(state.project.discoveryWarnings) ||
      JSON.stringify(saved.project.repositories) !== JSON.stringify(state.project.repositories)
    ) {
      state.setStep(1);
      throw new Error(
        'The project inputs have changed. Prepare and review the requirements before analyzing these inputs.',
      );
    }
    state.setBusy(true);
    state.setLog([]);
    state.setStep(3);
    await call('updateRuntime', { projectId: state.project.id, runtime: state.project.runtime });
    const r = await call('report', { projectId: state.project.id, browserCheck: true });
    state.setActiveRun(r.runId);
  });
}

/** Estimate remaining work for an accepted report; estimates never start on their own. */
async function estimate(
  state: WorkspaceState,
  call: DesktopBridge['request'],
  reportId: string,
  refreshHistory = false,
): Promise<void> {
  const projectId = state.project.id;
  await action(state, async () => {
    state.setLog(['Estimating remaining work…']);
    const r = await call('estimate', { projectId, reportId, refreshHistory });
    state.setRuns((await call('state', { projectId })).runs);
    state.setActiveRun(r.runId);
    state.setBusy(true);
  });
}

/** Check the saved app URL in a browser and follow that run in this window like any other. */
async function verify(state: WorkspaceState, call: DesktopBridge['request']): Promise<void> {
  const projectId = state.project.id;
  await action(state, async () => {
    const { url } = await call('verificationSettings', { projectId });
    if (!url) throw new Error('Save an app URL for this project first.');
    state.setLog([`Opening ${url} in a browser…`]);
    const r = await call('verify', { projectId });
    // The progress card names the run by its kind, so load the new run before showing it.
    state.setRuns((await call('state', { projectId })).runs);
    state.setActiveRun(r.runId);
    state.setBusy(true);
  });
}

/** Explicit user actions exposed by the workspace controller. */
export interface WorkspaceOperations {
  action: (fn: () => Promise<void>) => Promise<void>;
  load: (id: string) => Promise<void>;
  scanProjectFolder: (choose?: boolean) => Promise<void>;
  prepare: () => Promise<void>;
  analyze: () => Promise<void>;
  verify: () => Promise<void>;
  estimate: (reportId: string, refreshHistory?: boolean) => Promise<void>;
}
/** Bind the current render's state to user actions without performing side effects during render. */
export function workspaceOperations(
  state: WorkspaceState,
  call: DesktopBridge['request'],
  api: DesktopBridge | undefined,
): WorkspaceOperations {
  return {
    action: (fn) => action(state, fn),
    load: (id) => load(state, call, id),
    scanProjectFolder: (choose) => scanProjectFolder(state, call, api, choose),
    prepare: () => prepare(state, call),
    analyze: () => analyze(state, call),
    verify: () => verify(state, call),
    estimate: (reportId, refreshHistory) => estimate(state, call, reportId, refreshHistory),
  };
}
