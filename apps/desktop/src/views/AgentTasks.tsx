import type { JSX, ReactNode } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { lastError } from '../components/TeamTaskStatus';
import {
  type Dot,
  memberName,
  projectName,
  toggle,
  when,
  WorkCard,
  WorkDot,
  WorkRow,
} from './WorkCard';

/** What a person can do to a team task from Agents. */
export type TaskAction = 'stop' | 'rerun' | 'remove';

/** The words and look of one task row, and what its detail offers. */
interface TaskLine {
  dot: Dot;
  sub: string;
  meta: string;
  note?: string | undefined;
  facts: [string, string][];
  actions: TaskAction[];
}

/** Everything a section of task rows needs from the page. */
export interface TaskCardProps {
  state: AccountState;
  open: string | null;
  setOpen: (id: string | null) => void;
  /** The task an action is running on, so its buttons wait. */
  acting: string | null;
  act: (task: AccountTask, action: TaskAction) => void;
  openProject: (projectId: string) => void;
}

/** The machine a task ran or runs on, and whose it is. */
export function machine(state: AccountState, task: AccountTask): string {
  const device = state.devices.find((d) => d.deviceId === task.leasedDeviceId);
  return device ? `${device.name} (${memberName(state, device.owner)})` : 'A teammate’s machine';
}

/** How many tries a task has had, for its detail. */
function tries(task: AccountTask): string {
  return task.attempts === 1 ? '1 try' : `${task.attempts} tries`;
}

/**
 * A running task: what it is doing now and on which machine.
 * Example: progress "Running pnpm test" on Ci's MacBook reads "Now: Running pnpm test".
 */
export function runningLine(state: AccountState, task: AccountTask): TaskLine {
  return {
    dot: 'live',
    sub: task.progress ? `Now: ${task.progress}` : 'Starting',
    meta: machine(state, task),
    facts: [
      ['Runs on', machine(state, task)],
      ['Project', projectName(state, task)],
      ['Queued', when(task.queuedAt)],
    ],
    actions: ['stop'],
  };
}

/** A task waiting for a machine with room, or paused for a person's answer. */
export function waitingLine(state: AccountState, task: AccountTask): TaskLine {
  const error = lastError(task);
  const paused = task.status === 'blocked';
  return {
    dot: paused ? 'brand' : 'quiet',
    sub: paused
      ? 'Waiting for an answer in My work'
      : (task.waiting ?? 'The next machine with room picks it up'),
    meta: projectName(state, task),
    note: task.attempts && error ? `Tried ${tries(task)}. Last error: ${error}` : undefined,
    facts: [
      ['Queued', when(task.queuedAt)],
      ['Tries so far', String(task.attempts)],
    ],
    actions: ['stop'],
  };
}

/** A task that ran out of tries: why it stopped, with Run again and Remove. */
export function stoppedLine(state: AccountState, task: AccountTask): TaskLine {
  const error = lastError(task);
  return {
    dot: 'warn',
    sub: error ?? `Stopped after ${tries(task)}`,
    meta: when(task.updatedAt),
    note: error ? `Stopped after ${tries(task)}. Last error: ${error}` : undefined,
    facts: [
      ['Last ran on', machine(state, task)],
      ['Project', projectName(state, task)],
      ['Stopped', when(task.updatedAt)],
    ],
    actions: ['rerun', 'remove'],
  };
}

/** A task that finished: who ran it and when. */
export function finishedLine(state: AccountState, task: AccountTask): TaskLine {
  return {
    dot: 'brand',
    sub: `${machine(state, task)} · ${projectName(state, task)}`,
    meta: `Done ${when(task.updatedAt)}`,
    facts: [],
    actions: [],
  };
}

/** The button text for each action. */
const labels: Record<TaskAction, string> = { stop: 'Stop', rerun: 'Run again', remove: 'Remove' };

/** One section of task rows; each row opens to its facts, the full reason, and its buttons. */
export function TaskCard({
  icon,
  title,
  empty,
  tasks,
  line,
  ...page
}: TaskCardProps & {
  icon: ReactNode;
  title: string;
  empty: string;
  tasks: AccountTask[];
  line: (state: AccountState, task: AccountTask) => TaskLine;
}): JSX.Element {
  const { state, open, setOpen, acting, act, openProject } = page;
  return (
    <WorkCard icon={icon} title={title} count={tasks.length} empty={empty}>
      {tasks.map((task) => {
        const row = line(state, task);
        return (
          <WorkRow
            key={task.id}
            lead={<WorkDot dot={row.dot} />}
            title={task.title}
            sub={row.sub}
            meta={row.meta}
            open={open === task.id}
            onToggle={() => setOpen(toggle(open, task.id))}
          >
            {row.note && <p className="work-note">{row.note}</p>}
            {row.facts.length > 0 && (
              <div className="work-facts">
                {row.facts.map(([name, value]) => (
                  <div key={name}>
                    <span>{name}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="work-actions">
              {row.actions.map((action) => (
                <button
                  key={action}
                  className={action === 'rerun' ? 'work-solid' : 'work-soft'}
                  disabled={acting === task.id}
                  onClick={() => act(task, action)}
                >
                  {labels[action]}
                </button>
              ))}
              <button className="work-soft" onClick={() => openProject(task.projectId)}>
                Open project
              </button>
            </div>
          </WorkRow>
        );
      })}
    </WorkCard>
  );
}
