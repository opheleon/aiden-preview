import { type JSX, useEffect, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { teamTaskStatus } from '../../../../packages/contracts/src/task-model';
import type { Workspace } from '../hooks/useWorkspace';
import { TaskChip, TaskStatusTag } from './TaskTags';

/** How often the status refreshes while Aiden's task is unfinished, and otherwise. */
const activeMs = 5_000;
const idleMs = 30_000;

/** The error a failed attempt left, if any. */
function lastError(task: AccountTask): string | null {
  const result = task.result as { error?: unknown } | null;
  return typeof result?.error === 'string' ? result.error : null;
}

/**
 * What Aiden's team task is doing, in one sentence: waiting for a machine, running on one, or why
 * it stopped. Example: "Tried 2 times. Last error: ... It tries again on the next machine."
 */
function describe(state: AccountState, task: AccountTask): string {
  const machine = state.devices.find((d) => d.deviceId === task.leasedDeviceId)?.name;
  const error = lastError(task);
  if (task.status === 'leased')
    return `Running on ${machine ?? 'a teammate’s machine'}.${task.progress ? ` Now: ${task.progress}` : ''}`;
  if (task.status === 'blocked') return 'Waiting for an answer in My work.';
  if (task.status === 'cancelled') return 'Stopped. Nothing runs until you try again.';
  if (task.status === 'failed')
    return `Stopped after ${task.attempts} tries.${error ? ` Last error: ${error}` : ''}`;
  if (task.attempts > 0)
    return `Tried ${task.attempts} ${task.attempts === 1 ? 'time' : 'times'}.${error ? ` Last error: ${error}` : ''} It tries again on the next machine that asks.`;
  return task.waiting ?? 'Waiting for a machine on your team to pick it up.';
}

/** The project's latest Aiden task, while it is unfinished or ended without finishing. */
function current(state: AccountState, projectId: string): AccountTask | null {
  const latest = state.tasks
    .filter((t) => t.projectId === projectId && t.actor === 'agent')
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
  return latest && latest.status !== 'done' ? latest : null;
}

/**
 * For a team project, show Aiden's task as the team queue sees it, so "writing requirements" is
 * never an unexplained wait: who, what, where it stands, why, and Stop or Try again.
 */
export function TeamTaskStatus({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const { call, project } = workspace;
  const accountId = project.account?.accountId;
  const [state, setState] = useState<AccountState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const task = state ? current(state, project.id) : null;
  const unfinished = !!task && ['queued', 'leased', 'blocked'].includes(task.status);
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
  if (!state || !task) return null;
  /** Run one change, show its failure, and refresh. */
  const act = async (method: 'accountCancelTask' | 'accountRetryTask') => {
    setWorking(true);
    setError('');
    try {
      await call(method, { taskId: task.id });
      if (accountId) setState(await call('accountState', { accountId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="team-task" aria-label="Aiden’s team task">
      <div className="task-row-head">
        <TaskChip who="Aiden" />
        <strong>{task.title}</strong>
        <TaskStatusTag status={teamTaskStatus(task.status)} />
        {unfinished ? (
          <button
            className="text-button"
            disabled={working}
            onClick={() => void act('accountCancelTask')}
          >
            Stop
          </button>
        ) : (
          <button
            className="text-button"
            disabled={working}
            onClick={() => void act('accountRetryTask')}
          >
            Try again
          </button>
        )}
      </div>
      <p className="account-muted">{describe(state, task)}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
