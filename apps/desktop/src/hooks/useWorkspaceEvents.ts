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
>;
type EventContext = EventState & {
  projectId: string;
  call: DesktopBridge['request'];
  scheduleEstimate: (reportId: string) => void;
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

/** Publish accepted artifacts, then schedule the existing report-to-estimation continuation. */
function completed(state: EventContext, event: RunEvent): void {
  if (event.report) state.setReport(event.report);
  if (event.estimation) {
    state.setEstimation(event.estimation);
    state.setOverrides(overridesFrom(event.estimation));
  }
  state.setActiveRun('');
  state.setBusy(false);
  state.setQuestion(undefined);
  state.setStep(3);
  refreshHistory(state);
  if (event.report && event.trigger !== 'scheduled') state.scheduleEstimate(event.report.id);
}

/** Route current-project events while keeping background and scheduled clarification handling separate. */
function receive(state: EventContext, event: RunEvent): void {
  if (event.projectId && event.projectId !== state.projectId) {
    if (['completed', 'failed', 'cancelled'].includes(event.type))
      state.setNotice('A background run finished. Open its project to review history.');
    return;
  }
  if (event.trigger === 'scheduled' && event.type === 'clarification') return;
  switch (event.type) {
    case 'progress':
      state.setBusy(true);
      state.setLog((lines) => [...lines.slice(-49), event.message ?? 'Working…']);
      state.setActiveRun(event.runId);
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

/** Observe the selected project and cancel pending renderer continuations when it changes or unmounts. */
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
  } = state;
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
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
      scheduleEstimate: (reportId) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          setBusy(true);
          setLog(['Preparing original-scope and remaining-work estimates…']);
          void call('estimate', { projectId, reportId })
            .then((result) => setActiveRun(result.runId))
            .catch((error: unknown) => {
              setBusy(false);
              setError(error instanceof Error ? error.message : 'Estimation could not start.');
            });
        }, 250);
        timers.add(timer);
      },
    };
    const unsubscribe = api?.onEvent((event) => receive(context, event));
    return () => {
      unsubscribe?.();
      for (const timer of timers) clearTimeout(timer);
    };
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
  ]);
}
