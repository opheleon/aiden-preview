import { useCallback, useEffect, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import type { Workspace } from '../hooks/useWorkspace';

/** How often the status refreshes while Aiden's task is unfinished, and otherwise. */
const activeMs = 5_000;
const idleMs = 30_000;

/** The error a failed attempt left, if any. */
export function lastError(task: AccountTask): string | null {
  const result = task.result as { error?: unknown } | null;
  return typeof result?.error === 'string' ? result.error : null;
}

/** Finished work waiting on a person: who reviews it, or how far its checks have come. */
function reviewLine(state: AccountState, task: AccountTask): string {
  if (task.status === 'verify') {
    const passed = task.checks.filter((c) => c.state === 'passed').length;
    return `Approved. ${passed} of ${task.checks.length} checks passed so far.`;
  }
  const reviewer = state.members.find((m) => m.id === task.reviewerUserId);
  return reviewer
    ? `Waiting for ${reviewer.name || reviewer.email} to review it in Work.`
    : 'Waiting for the team to pick a reviewer.';
}

/**
 * The note a finished task left, if any. Example: a Morning check on a project with no
 * requirements yet reads "Nothing to check yet: this project has no requirements."
 */
export function taskNote(task: AccountTask): string | null {
  const result = task.result as { note?: unknown } | null;
  return typeof result?.note === 'string' ? result.note : null;
}

/**
 * Where to turn pickup on, while no machine heard from recently is taking team work. Example: a
 * team whose only open Aiden has pickup off reads "Turn on Pick up team work in Settings > Teams."
 */
export function pickupHint(state: AccountState): string | null {
  return state.devices.some((d) => d.pickupEnabled)
    ? null
    : 'Turn on Pick up team work in Settings > Teams.';
}

/**
 * What Aiden's team task is doing, in one sentence: waiting for a machine, running on one, or why
 * it stopped. Example: "Tried 2 times. Last error: ... It tries again on the next machine."
 */
export function describeTeamTask(state: AccountState, task: AccountTask): string {
  const machine = state.devices.find((d) => d.deviceId === task.leasedDeviceId)?.name;
  const error = lastError(task);
  if (task.status === 'leased')
    return `Running on ${machine ?? 'a teammate’s machine'}.${task.progress ? ` Now: ${task.progress}` : ''}`;
  if (task.status === 'blocked') return 'Waiting for an answer in Work.';
  if (task.status === 'review' || task.status === 'verify') return reviewLine(state, task);
  if (task.status === 'cancelled') return 'Stopped. Nothing runs until you try again.';
  if (task.status === 'failed')
    return `Failed after ${task.attempts} tries.${error ? ` Last error: ${error}` : ''}`;
  if (task.attempts > 0)
    return `Tried ${task.attempts} ${task.attempts === 1 ? 'time' : 'times'}.${error ? ` Last error: ${error}` : ''} It tries again on the next machine that asks.`;
  return waitingLine(state, task);
}

/** Why a queued team task has not started yet, and where to turn pickup on when nobody has it. */
function waitingLine(state: AccountState, task: AccountTask): string {
  const hint = pickupHint(state);
  const waiting = task.waiting
    ? `${task.waiting}.`
    : 'Waiting for a machine on your team to pick it up.';
  return hint ? `${waiting} ${hint}` : waiting;
}

/** The project's latest Aiden task, while it is unfinished or ended without finishing. */
function current(state: AccountState, projectId: string): AccountTask | null {
  const latest = state.tasks
    .filter((t) => t.projectId === projectId && t.actor === 'agent')
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
  return latest && latest.status !== 'done' ? latest : null;
}

/** A team project's current Aiden task as the team queue sees it, with Stop and Try again. */
export interface TeamTask {
  state: AccountState | null;
  task: AccountTask | null;
  /** Queued, running, or paused for an answer. */
  unfinished: boolean;
  working: boolean;
  error: string;
  stop: () => Promise<void>;
  retry: () => Promise<void>;
}

/**
 * Follow a team project's Aiden task, so "writing requirements" is never an unexplained wait.
 * Solo projects answer with no task and never touch the network.
 */
export function useTeamTask(workspace: Workspace): TeamTask {
  const { call, project } = workspace;
  const accountId = project.account?.accountId;
  const [state, setState] = useState<AccountState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const task = state && accountId ? current(state, project.id) : null;
  const unfinished =
    !!task && ['queued', 'leased', 'blocked', 'review', 'verify'].includes(task.status);
  useEffect(() => {
    if (!accountId) return;
    let closed = false;
    /** Read the team queue; drop the answer if this project closed meanwhile. */
    const load = () =>
      void call('accountState', { accountId })
        .then((next) => {
          if (!closed) setState(next);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, unfinished ? activeMs : idleMs);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [call, accountId, unfinished]);
  /** Run one change, show its failure, and refresh. */
  const act = useCallback(
    async (method: 'accountCancelTask' | 'accountRetryTask') => {
      if (!task || !accountId) return;
      setWorking(true);
      setError('');
      try {
        await call(method, { taskId: task.id });
        setState(await call('accountState', { accountId }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work. Try again.');
      } finally {
        setWorking(false);
      }
    },
    [call, task, accountId],
  );
  return {
    state,
    task,
    unfinished,
    working,
    error,
    stop: () => act('accountCancelTask'),
    retry: () => act('accountRetryTask'),
  };
}
