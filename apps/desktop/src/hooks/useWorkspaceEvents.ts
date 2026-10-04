import { useEffect } from 'react';

import type { RunEvent } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import type { WorkspaceState } from './useWorkspaceState';

type EventState = Pick<
  WorkspaceState,
  | 'setProject'
  | 'setProjects'
  | 'setNotice'
  | 'setBusy'
  | 'setLive'
  | 'setLiveByRun'
  | 'setActiveRuns'
  | 'setActiveRun'
  | 'setReport'
  | 'setRuns'
  | 'setBaseline'
  | 'setActivity'
  | 'setCalls'
  | 'setError'
  | 'setVerification'
>;
type EventContext = EventState & {
  projectId: string;
  call: DesktopBridge['request'];
  seen: Set<string>;
  current: () => boolean;
};

/** Report a failed refresh through the normal error banner. */
function failed(state: EventContext, fallback: string): (error: unknown) => void {
  return (error) => state.setError(error instanceof Error ? error.message : fallback);
}

/**
 * Reload what Aiden knows about the project after it changed: run history, what done means, calls,
 * and the action log. Each part refreshes on its own so one failure does not hide the rest.
 */
function refreshProject(state: EventContext, ended = ''): void {
  const projectId = state.projectId;
  if (ended) state.setActiveRuns((ids) => ids.filter((id) => id !== ended));
  void state
    .call('state', { projectId })
    .then((saved) => {
      if (!state.current()) return;
      state.setProject(saved.project);
      state.setProjects((projects) =>
        projects.map((p) => (p.id === saved.project.id ? saved.project : p)),
      );
      state.setRuns(saved.runs);
      state.setBaseline(saved.baseline ?? undefined);
      // A run that just ended can still be finishing its cleanup when the worker answers.
      const active = saved.activeRunIds.filter((id) => id !== ended);
      state.setActiveRuns(active);
      // Another run, such as the browser check beside a code check, keeps Aiden working.
      if (ended) state.setBusy(active.length > 0);
    })
    .catch(failed(state, 'Could not refresh the project.'));
  void state
    .call('calls', { projectId })
    .then(state.setCalls)
    .catch(failed(state, 'Could not load calls.'));
  void state
    .call('activity', { projectId })
    .then(state.setActivity)
    .catch(failed(state, 'Could not load the activity.'));
}

/** Reload one run's verification result, so Watch reflects what it just checked. */
function refreshVerification(state: EventContext, runId: string): void {
  void state
    .call('verification', { projectId: state.projectId, runId })
    .then(state.setVerification)
    .catch(failed(state, 'Could not load the browser check.'));
}

/** Publish finished work: a new report, a browser check, or a rewritten "what done means". */
function completed(state: EventContext, event: RunEvent): void {
  if (event.report) state.setReport(event.report);
  if (event.verification) refreshVerification(state, event.runId);
  state.setActiveRun('');
  state.setBusy(false);
  state.setLive('');
  refreshProject(state, event.runId);
}

/**
 * A run stopped. The brief explains a stopped look from its saved run, with a way to look again,
 * so only problems that no run records (such as a follow-up that could not start) use the banner.
 */
function stopped(state: EventContext, event: RunEvent): void {
  state.setActiveRun('');
  state.setBusy(false);
  state.setLive('');
  refreshProject(state, event.runId);
  void state
    .call('state', { projectId: state.projectId })
    .then((saved) => {
      const run = saved.runs.find((r) => r.id === event.runId);
      if (!run || run.status === 'completed') state.setError(event.message ?? 'Aiden stopped.');
    })
    .catch(failed(state, 'Could not refresh the project.'));
}

/** Add a live action-log line, newest first, without duplicating one already loaded. */
function activity(state: EventContext, event: RunEvent): void {
  const entry = event.activity;
  if (!entry) return;
  // Steps belong to a run's full history, not the brief.
  if (entry.kind !== 'step')
    state.setActivity((entries) =>
      entries.some((e) => e.at === entry.at && e.summary === entry.summary)
        ? entries
        : [entry, ...entries],
    );
  state.setLive(entry.summary);
  state.setLiveByRun((runs) => ({ ...runs, [entry.runId]: entry.summary }));
  if (entry.kind === 'ask' || entry.kind === 'decide')
    void state
      .call('calls', { projectId: state.projectId })
      .then(state.setCalls)
      .catch(failed(state, 'Could not load calls.'));
}

/** Route current-project events; other projects only get a quiet notice when they finish. */
function receive(state: EventContext, event: RunEvent): void {
  if (event.projectId && event.projectId !== state.projectId) {
    if (event.type === 'completed') {
      state.setNotice('Aiden finished a look on another project. Open it to see the brief.');
      void state
        .call('projects')
        .then(state.setProjects)
        .catch(failed(state, 'Could not refresh project names.'));
    }
    return;
  }
  switch (event.type) {
    case 'coding':
      // External jobs have their own delivery view; never mix them into analyst run history.
      break;
    case 'progress':
      if (!state.seen.has(event.runId)) {
        state.seen.add(event.runId);
        void state
          .call('state', { projectId: state.projectId })
          .then((saved) => {
            if (state.current()) state.setRuns(saved.runs);
          })
          .catch(failed(state, 'Could not refresh runs.'));
      }
      state.setActiveRuns((ids) => (ids.includes(event.runId) ? ids : [...ids, event.runId]));
      state.setBusy(true);
      state.setActiveRun(event.runId);
      if (event.message) {
        state.setLive(event.message);
        const message = event.message;
        state.setLiveByRun((runs) => ({ ...runs, [event.runId]: message }));
      }
      // A completed criterion inside a still-running verification: let Watch show it now.
      if (event.verification) refreshVerification(state, event.runId);
      break;
    case 'activity':
      activity(state, event);
      break;
    case 'review':
    case 'completed':
      completed(state, event);
      break;
    case 'failed':
    case 'cancelled':
      stopped(state, event);
      break;
  }
}

/** Observe worker events for the selected project and route other projects' events to notices. */
export function useWorkspaceEvents(
  state: WorkspaceState,
  api: DesktopBridge | undefined,
  call: DesktopBridge['request'],
): void {
  const {
    project: { id: projectId },
    setProject,
    setProjects,
    setNotice,
    setBusy,
    setLive,
    setLiveByRun,
    setActiveRuns,
    setActiveRun,
    setReport,
    setRuns,
    setBaseline,
    setActivity,
    setCalls,
    setError,
    setVerification,
  } = state;
  useEffect(() => {
    let current = true;
    const context: EventContext = {
      projectId,
      call,
      seen: new Set(),
      current: () => current,
      setProject,
      setProjects,
      setNotice,
      setBusy,
      setLive,
      setLiveByRun,
      setActiveRuns,
      setActiveRun,
      setReport,
      setRuns,
      setBaseline,
      setActivity,
      setCalls,
      setError,
      setVerification,
    };
    const unsubscribe = api?.onEvent((event) => receive(context, event));
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [
    api,
    call,
    projectId,
    setProject,
    setProjects,
    setNotice,
    setBusy,
    setLive,
    setLiveByRun,
    setActiveRuns,
    setActiveRun,
    setReport,
    setRuns,
    setBaseline,
    setActivity,
    setCalls,
    setError,
    setVerification,
  ]);
}
