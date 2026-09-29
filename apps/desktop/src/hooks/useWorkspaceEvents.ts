import { useEffect } from 'react';

import type { RunEvent } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import { overridesFrom } from '../renderer/project-state';
import type { WorkspaceState } from './useWorkspaceState';

type EventState = Pick<
  WorkspaceState,
  | 'setNotice'
  | 'setBusy'
  | 'setLog'
  | 'setActiveRun'
  | 'setQuestion'
  | 'setAnswer'
  | 'setProduct'
  | 'setReviewRun'
  | 'setStep'
  | 'setReport'
  | 'setEstimation'
  | 'setOverrides'
  | 'setRuns'
  | 'setError'
  | 'setVerification'
>;
type EventContext = EventState & {
  projectId: string;
  call: DesktopBridge['request'];
  /** The run whose progress this window last showed; a new ID means a chained run started. */
  following: string;
};

/** Refresh saved history after terminal events, reporting worker failures through the normal UI. */
function refreshHistory(state: EventContext): void {
  void state
    .call('state', { projectId: state.projectId })
    .then((saved) => state.setRuns(saved.runs))
    .catch((error: unknown) =>
      state.setError(error instanceof Error ? error.message : 'Could not refresh run history.'),
    );
}

/** Reload the latest browser check so requirement states include its verdicts. */
function refreshVerification(state: EventContext): void {
  void state
    .call('verification', { projectId: state.projectId })
    .then(state.setVerification)
    .catch((error: unknown) =>
      state.setError(error instanceof Error ? error.message : 'Could not load the browser check.'),
    );
}

/** Publish accepted artifacts; estimates are only refreshed when someone asks for them. */
function completed(state: EventContext, event: RunEvent): void {
  if (event.report) state.setReport(event.report);
  if (event.verification) {
    state.setNotice(`Browser check finished. ${event.verification.line}`);
    refreshVerification(state);
  }
  if (event.estimation) {
    state.setEstimation(event.estimation);
    state.setOverrides(overridesFrom(event.estimation));
  }
  state.setActiveRun('');
  state.setBusy(false);
  state.setQuestion(undefined);
  state.setStep(3);
  refreshHistory(state);
}

/** Answer questions from runs in other projects and note when they finish, without leaving this one. */
function background(state: EventContext, event: RunEvent): void {
  if (event.type === 'clarification') {
    state.setQuestion(event);
    state.setAnswer('');
  }
  if (['completed', 'failed', 'cancelled'].includes(event.type)) {
    state.setQuestion((current) => (current?.runId === event.runId ? undefined : current));
    state.setNotice('A background run finished. Open its project to review history.');
  }
}

/** Show a run's progress, starting a fresh log when a chained run such as a browser check begins. */
function progress(state: EventContext, event: RunEvent): void {
  if (event.runId !== state.following) {
    if (state.following) state.setLog([]);
    state.following = event.runId;
    refreshHistory(state);
  }
  state.setBusy(true);
  state.setLog((lines) => [...lines.slice(-49), event.message ?? 'Working…']);
  state.setActiveRun(event.runId);
}

/** Route current-project events while keeping background and scheduled clarification handling separate. */
function receive(state: EventContext, event: RunEvent): void {
  if (event.trigger === 'scheduled' && event.type === 'clarification') return;
  if (event.projectId && event.projectId !== state.projectId) return background(state, event);
  switch (event.type) {
    case 'progress':
      progress(state, event);
      break;
    case 'clarification':
      state.setQuestion(event);
      state.setAnswer('');
      break;
    case 'review':
      state.setProduct(event.product);
      state.setReviewRun(event.runId);
      state.setActiveRun('');
      state.setBusy(false);
      state.setStep(2);
      break;
    case 'completed':
      completed(state, event);
      break;
    case 'failed':
    case 'cancelled':
      state.setError(event.message ?? 'Run stopped.');
      state.setActiveRun('');
      state.setBusy(false);
      state.setQuestion(undefined);
      refreshHistory(state);
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
    setNotice,
    setBusy,
    setLog,
    setActiveRun,
    setQuestion,
    setAnswer,
    setProduct,
    setReviewRun,
    setStep,
    setReport,
    setEstimation,
    setOverrides,
    setRuns,
    setError,
    setVerification,
  } = state;
  useEffect(() => {
    const context: EventContext = {
      projectId,
      call,
      setNotice,
      setBusy,
      setLog,
      setActiveRun,
      setQuestion,
      setAnswer,
      setProduct,
      setReviewRun,
      setStep,
      setReport,
      setEstimation,
      setOverrides,
      setRuns,
      setError,
      setVerification,
      following: '',
    };
    return api?.onEvent((event) => receive(context, event));
  }, [
    api,
    call,
    projectId,
    setNotice,
    setBusy,
    setLog,
    setActiveRun,
    setQuestion,
    setAnswer,
    setProduct,
    setReviewRun,
    setStep,
    setReport,
    setEstimation,
    setOverrides,
    setRuns,
    setError,
    setVerification,
  ]);
}
