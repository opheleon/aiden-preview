import type { Product, RunManifest } from '../../../../packages/contracts/src/index';
import { scopeName } from '../../../../packages/contracts/src/project-name';
import type { DesktopBridge } from '../bridge';
import type { WorkspaceState } from './useWorkspaceState';

type Call = DesktopBridge['request'];

/** Surface failures from something the person did and release busy state for a retry. */
async function action(state: WorkspaceState, fn: () => Promise<void>): Promise<void> {
  state.setError('');
  try {
    await fn();
  } catch (e) {
    state.setError(e instanceof Error ? e.message : 'Something went wrong.');
    state.setBusy(false);
  }
}

/** Load a saved project and everything Aiden knows about it, without restarting interrupted work. */
async function load(state: WorkspaceState, call: Call, id: string): Promise<void> {
  await action(state, async () => {
    await call('monitoring', { projectId: id });
    const [s, calls, activity, confirmed] = await Promise.all([
      call('state', { projectId: id }),
      call('calls', { projectId: id }),
      call('activity', { projectId: id }),
      call('confirmations', { projectId: id }),
    ]);
    state.setConfirmed(confirmed);
    state.setProject(s.project);
    state.setBaseline(s.baseline ?? undefined);
    state.setRuns(s.runs);
    state.setCalls(calls);
    state.setActivity(activity);
    // Only follow runs this worker is executing; a manifest left running by the CLI or an exited
    // worker never sends events here, so adopting it would show progress forever.
    const running = s.runs.find((run) => s.activeRunIds.includes(run.id));
    state.setActiveRuns(s.activeRunIds);
    // Show what each run in progress is doing now, not only steps that arrive from here on.
    const steps = await Promise.all(
      s.activeRunIds.map(async (runId) => {
        const log = await call('runLog', { projectId: id, runId }).catch(() => []);
        return [runId, log.at(-1)?.summary ?? ''] as const;
      }),
    );
    state.setLiveByRun(Object.fromEntries(steps.filter(([, summary]) => summary)));
    state.setActiveRun(running?.id ?? '');
    state.setBusy(!!running);
    state.setLive(running ? (activity[0]?.summary ?? 'Aiden is working.') : '');
    state.setReport(undefined);
    state.setVerification(
      await call('verification', { projectId: id }).catch((e: unknown) => {
        state.setError(e instanceof Error ? e.message : 'Could not load the last browser check.');
        return null;
      }),
    );
    const latest = s.runs.find((r: RunManifest) => r.status === 'completed' && r.kind === 'report');
    if (latest) state.setReport(await call('result', { projectId: id, runId: latest.id }));
    state.setArea('projects');
  });
}

/** Find repositories in a folder, keeping notes on ones already listed and ignoring a replaced project. */
async function scanProjectFolder(
  state: WorkspaceState,
  call: Call,
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

/**
 * Hand the project to Aiden: it writes what done means, commits it without a review step, and
 * starts looking. Also used after changing the folder, which changes what Aiden looks at.
 */
async function start(state: WorkspaceState, call: Call): Promise<void> {
  await action(state, async () => {
    if (!state.project.context.trim())
      throw new Error(
        'Tell Aiden what you are building. Paste or type anything that describes it.',
      );
    if (!state.project.repositories.length)
      throw new Error('Choose the project folder. Aiden needs a Git repository inside it.');
    const project = { ...state.project, name: scopeName(state.project.context) };
    state.setBusy(true);
    state.setLive('Planning features and their requirements…');
    const r = await call('prepare', { project, autoAccept: true });
    state.setActiveRun(r.runId);
    state.setProject(project);
    state.setProjects(await call('projects'));
    state.setArea('projects');
  });
}

/** Ask Aiden to look now instead of waiting for the next commit or morning. */
async function lookNow(state: WorkspaceState, call: Call): Promise<void> {
  await action(state, async () => {
    state.setBusy(true);
    state.setLive('Starting a check…');
    const r = await call('look', { projectId: state.project.id });
    state.setActiveRun(r.runId);
  });
}

/** Make a call. Aiden acts on the answer straight away unless it is already working. */
async function answerCall(
  state: WorkspaceState,
  call: Call,
  callId: string,
  answer: string,
): Promise<void> {
  const projectId = state.project.id;
  await action(state, async () => {
    const r = await call('answerCall', { projectId, callId, answer });
    state.setCalls(await call('calls', { projectId }));
    if (r.runId) {
      state.setBusy(true);
      state.setActiveRun(r.runId);
      state.setLive('Using your answer…');
    } else state.setNotice('Got it. Aiden will use this as soon as its current work finishes.');
  });
}

/** Change what done means or the intent behind it; Aiden then looks again. */
async function editIntent(
  state: WorkspaceState,
  call: Call,
  change: { context: string } | { product: Product },
): Promise<void> {
  const projectId = state.project.id;
  await action(state, async () => {
    const r = await call('editIntent', { projectId, ...change });
    if ('context' in change) state.setProject((p) => ({ ...p, context: change.context }));
    state.setBusy(true);
    state.setActiveRun(r.runId);
    state.setLive('context' in change ? 'Rewriting the requirements…' : 'Running a check…');
  });
}

/** Mark a manual test done against the latest look; it is due again after the next one. */
async function confirm(state: WorkspaceState, call: Call, key: string): Promise<void> {
  const projectId = state.project.id;
  const reportId = state.report?.id;
  if (!reportId) return;
  await action(state, async () => {
    state.setConfirmed(await call('confirmAction', { projectId, key, reportId }));
  });
}

/** Actions the person can take, bound to the current workspace. */
export interface WorkspaceOperations {
  action: (fn: () => Promise<void>) => Promise<void>;
  load: (id: string) => Promise<void>;
  scanProjectFolder: (choose?: boolean) => Promise<void>;
  start: () => Promise<void>;
  lookNow: () => Promise<void>;
  answerCall: (callId: string, answer: string) => Promise<void>;
  editIntent: (change: { context: string } | { product: Product }) => Promise<void>;
  confirm: (key: string) => Promise<void>;
}
/** Bind the current render's state to user actions without performing side effects during render. */
export function workspaceOperations(
  state: WorkspaceState,
  call: Call,
  api: DesktopBridge | undefined,
): WorkspaceOperations {
  return {
    action: (fn) => action(state, fn),
    load: (id) => load(state, call, id),
    scanProjectFolder: (choose) => scanProjectFolder(state, call, api, choose),
    start: () => start(state, call),
    lookNow: () => lookNow(state, call),
    answerCall: (callId, answer) => answerCall(state, call, callId, answer),
    editIntent: (change) => editIntent(state, call, change),
    confirm: (key) => confirm(state, call, key),
  };
}
