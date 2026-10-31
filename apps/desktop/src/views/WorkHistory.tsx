import { type JSX, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { lastError, taskNote } from '../components/TeamTaskStatus';
import {
  agentKind,
  closedProjectTasks,
  historyDays,
  machine,
  outcome,
  rerunOf,
  type TaskAction,
} from './work-tasks';
import { finishedWord, projectName, toggle, when } from './WorkCard';

/** What History needs from the Work page. */
interface HistoryProps {
  state: AccountState;
  acting: string | null;
  act: (task: AccountTask, action: TaskAction) => void;
  openProject: (projectId: string) => void;
}

/**
 * The line under a History row: where it ran and, for an Aiden task, what happened next.
 * Example: a failed build someone reran reads "Billing · Alice MacBook (Alice) · Ran again".
 */
function historyLine(state: AccountState, task: AccountTask): string {
  const parts = [projectName(state, task)];
  if (task.actor === 'agent' && task.leasedDeviceId) parts.push(machine(state, task));
  if (task.actor === 'human') parts.push('You');
  const note = taskNote(task);
  if (note) parts.push(note);
  if (task.actor === 'agent' && rerunOf(state, task)) parts.push('Ran again');
  return parts.join(' · ');
}

/** What an open History row says about how its task ended. */
function HistoryNote({ task, ended }: { task: AccountTask; ended: string }): JSX.Element | null {
  const error = lastError(task);
  if (error && ended === 'Failed')
    return (
      <p className="work-note">
        Failed after {task.attempts} {task.attempts === 1 ? 'try' : 'tries'}. Last error: {error}
      </p>
    );
  if (ended === 'Stopped')
    return (
      <p className="work-note">
        Stopped before it finished. Nothing runs until someone runs it again.
      </p>
    );
  if (ended === 'Held')
    return <p className="work-note">This project is closed. Reopen it to continue this work.</p>;
  return null;
}

/**
 * One History row that opens in place. Work on a closed project reads Held until it ends and
 * offers no Run again, since nothing runs there until someone reopens the project.
 */
function HistoryRow({
  task,
  closed,
  open,
  onToggle,
  state,
  acting,
  act,
  openProject,
}: HistoryProps & {
  task: AccountTask;
  closed: boolean;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const ended = outcome(task) ?? 'Held';
  const again = !closed && task.actor === 'agent' && ended !== 'Done' && !rerunOf(state, task);
  const kind = task.actor === 'agent' ? agentKind(task) : null;
  return (
    <div className="work-row">
      <div className="work-row-line">
        <button className="work-item" aria-expanded={open} onClick={onToggle}>
          {/* Reviewed work says how it ended: Verified, Checks failed, or Changes requested. */}
          <span className={`work-pill work-pill--${ended.toLowerCase()}`}>
            {ended === 'Done' ? finishedWord(task) : ended}
          </span>
          <span className="work-text">
            <span className="work-title">{kind?.title ?? task.title}</span>
            <span className="work-sub">{historyLine(state, task)}</span>
          </span>
          {kind && (
            <span className="work-kind">
              <span className="work-tag">{kind.tag}</span>
            </span>
          )}
          <span className="work-meta">{when(task.updatedAt)}</span>
        </button>
        {again && (
          <button
            className="work-solid work-inline"
            disabled={acting === task.id}
            onClick={() => act(task, 'rerun')}
          >
            Run again
          </button>
        )}
      </div>
      {open && (
        <div className="work-detail">
          <HistoryNote task={task} ended={ended} />
          <div className="work-actions">
            <button className="work-soft" onClick={() => openProject(task.projectId)}>
              Open project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * History: every task that ended, newest first by day, each marked Done, Failed (ran out of tries),
 * or Stopped (a person pressed Stop). Failed and Stopped Aiden work offers Run again on the row.
 * Closed projects' work is kept in one folded group at the bottom.
 */
export function WorkHistory(props: HistoryProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const days = historyDays(props.state);
  const closed = closedProjectTasks(props.state);
  /** One History row; rows open one at a time. */
  const row = (task: AccountTask, inClosed: boolean) => (
    <HistoryRow
      key={task.id}
      {...props}
      task={task}
      closed={inClosed}
      open={open === task.id}
      onToggle={() => setOpen(toggle(open, task.id))}
    />
  );
  if (!days.length && !closed.length)
    return <p className="work-empty">Finished, failed, and stopped work shows here.</p>;
  return (
    <>
      {days.map(({ day, tasks }) => (
        <section key={day} className="work-card" aria-label={day}>
          <div className="work-card-head">
            <span>{day}</span>
            <span className="work-count">{tasks.length}</span>
          </div>
          {tasks.map((task) => row(task, false))}
        </section>
      ))}
      {closed.length > 0 && (
        <details className="work-card work-closed" aria-label="Closed projects">
          <summary>
            <span>Closed projects</span>
            <span className="work-count">{closed.length}</span>
          </summary>
          {closed.map((task) => row(task, true))}
        </details>
      )}
    </>
  );
}
