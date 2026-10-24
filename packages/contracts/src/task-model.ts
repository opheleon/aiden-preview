import type { SetupStepId } from './guide.js';

/**
 * One definition of a task, shared by the project view and My work: who does it, what it is
 * called, and where it stands. Setup steps, action items, and team queue entries all map onto it,
 * so the same piece of work has the same name and status words everywhere.
 */

/** Who does a task: Aiden itself, or a person in the PM or Dev role. */
export type TaskWho = 'Aiden' | 'PM' | 'Dev';

/** Where a task stands. Failed appears only when Aiden gave up after retries; stopped when someone stopped it. */
export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'failed' | 'stopped';

/** The status words every screen uses. */
export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** Who does each setup step, and the task name used in the checklist and on the team queue. */
export const setupTasks: Record<SetupStepId, { who: TaskWho; action: string }> = {
  understand: { who: 'Aiden', action: 'Write requirements' },
  confirm: { who: 'PM', action: 'Review requirements' },
  code: { who: 'Dev', action: 'Connect code' },
  verify: { who: 'PM', action: 'Choose checks' },
  'first-check': { who: 'Aiden', action: 'Run first check' },
  extras: { who: 'PM', action: 'Link ticket tracker' },
};

/** Team queue kind for a setup step a person does, for example `setup-confirm`. */
export function setupTaskKind(step: SetupStepId): string {
  return `setup-${step}`;
}

/**
 * The setup step a team task stands for, if it is one.
 * @param kind The team task's kind.
 */
export function setupStepOf(kind: string): SetupStepId | null {
  const step = kind.startsWith('setup-') ? kind.slice('setup-'.length) : '';
  return step in setupTasks ? (step as SetupStepId) : null;
}

/**
 * Where a team task stands, in the shared status words.
 * @param status The team queue status.
 */
export function teamTaskStatus(
  status: 'queued' | 'leased' | 'blocked' | 'done' | 'failed' | 'cancelled',
): TaskStatus {
  if (status === 'leased') return 'in-progress';
  if (status === 'done') return 'done';
  if (status === 'cancelled') return 'stopped';
  if (status === 'failed') return 'failed';
  return 'todo';
}
