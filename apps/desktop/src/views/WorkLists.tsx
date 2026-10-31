import { Check } from 'lucide-react';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { pickupHint } from '../components/TeamTaskStatus';
import type { AccountView } from '../hooks/useAccount';
import { ReviewDetail, VerifyDetail } from './ReviewWork';
import {
  agentKind,
  type AgentStanding,
  cardLine,
  machine,
  reviewing,
  standing,
  type TaskAction,
  workLists,
} from './work-tasks';
import { projectName, toggle, when } from './WorkCard';
import { HumanTaskDetail } from './WorkHuman';

/** How long a row that was just picked up says who took it. */
const pickedMs = 4_000;

/** Everything the lists need from the page. */
export interface ListProps {
  state: AccountState;
  account: AccountView;
  me: string | null;
  /** The task an action is running on, so its buttons wait. */
  acting: string | null;
  act: (task: AccountTask, action: TaskAction) => void;
  openProject: (projectId: string) => void;
}

/**
 * The Aiden tasks a machine just picked up: running now after this page last saw them waiting.
 * Each stays in the set for a few seconds so its row can say who took it.
 */
function usePickedUp(state: AccountState): ReadonlySet<string> {
  const seen = useRef(new Map<string, AccountTask['status']>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const fresh = state.tasks
      .filter((t) => t.status === 'leased' && seen.current.get(t.id) === 'queued')
      .map((t) => t.id);
    seen.current = new Map(state.tasks.map((t) => [t.id, t.status]));
    if (!fresh.length) return;
    setPicked((now) => new Set([...now, ...fresh]));
    // Work refreshes every few seconds, so each pickup keeps its own timer until it ends.
    timers.current.push(
      setTimeout(
        () => setPicked((now) => new Set([...now].filter((id) => !fresh.includes(id)))),
        pickedMs,
      ),
    );
  }, [state]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return picked;
}

/** How an Aiden row ends: a pulsing Running, a quiet Waiting or In review, or a check when done. */
function StandingMark({ standing: where }: { standing: AgentStanding }): JSX.Element | null {
  if (where === 'Running')
    return (
      <span className="work-running">
        <span className="work-dot work-dot--live work-pulse" aria-hidden="true" />
        Running
      </span>
    );
  if (where === 'Waiting') return <span className="work-meta">Waiting</span>;
  if (where === 'In review') return <span className="work-meta">In review</span>;
  if (where === 'Done') return <Check size={14} className="work-done" aria-label="Done" />;
  return null;
}

/** One row: what it is, the line under it, its kind and where an Aiden task stands, and detail. */
function Row({
  title,
  tag,
  sub,
  standing: where,
  picked,
  open,
  onToggle,
  inline,
  children,
}: {
  title: string;
  /** The kind of Aiden work, such as Build, shown on the right; absent for your own tasks. */
  tag?: string | undefined;
  sub: string;
  /** Where an Aiden task stands; absent for your own tasks. */
  standing?: AgentStanding | undefined;
  picked: boolean;
  open: boolean;
  onToggle: () => void;
  /** An action that takes the place of the standing, such as Run again. */
  inline?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const tone = where === 'Failed' ? ' work-row--failed' : picked ? ' work-row--picked' : '';
  return (
    <div className={`work-row${tone}`}>
      <div className="work-row-line">
        <button className="work-item" aria-expanded={open} onClick={onToggle}>
          <span className="work-text">
            <span className="work-title">{title}</span>
            <span className="work-sub">{sub}</span>
          </span>
          {/* A fixed-width column, so every tag starts at the same place. */}
          {tag && (
            <span className="work-kind">
              <span className="work-tag">{tag}</span>
            </span>
          )}
        </button>
        {/* One fixed-width slot per Aiden row, so tags line up whatever ends the row. */}
        {where && <span className="work-slot">{inline ?? <StandingMark standing={where} />}</span>}
      </div>
      {open && <div className="work-detail">{children}</div>}
    </div>
  );
}

/** What an open Aiden row shows: where it runs or ran, and Stop, Dismiss, or Open project. */
function AgentDetail({
  task,
  state,
  acting,
  act,
  openProject,
}: { task: AccountTask } & Pick<ListProps, 'state' | 'acting' | 'act' | 'openProject'>) {
  const unfinished = ['queued', 'leased', 'blocked', 'review', 'verify'].includes(task.status);
  const where = task.leasedDeviceId ? machine(state, task) : 'Not picked up yet';
  const hint = task.status === 'queued' ? pickupHint(state) : null;
  return (
    <>
      <p className="work-note">
        {projectName(state, task)} · {where} · Queued {when(task.queuedAt)}
      </p>
      {hint && <p className="work-note">{hint}</p>}
      <div className="work-actions">
        {unfinished && (
          <button
            className="work-soft"
            disabled={acting === task.id}
            onClick={() => act(task, 'stop')}
          >
            Stop
          </button>
        )}
        {task.status === 'failed' && (
          <button
            className="work-soft"
            disabled={acting === task.id}
            onClick={() => act(task, 'dismiss')}
          >
            Dismiss
          </button>
        )}
        <button className="text-button" onClick={() => openProject(task.projectId)}>
          Open project
        </button>
      </div>
    </>
  );
}

/**
 * Work's Active tab: two lists, Your tasks and Agent tasks. Each row is one line that opens in
 * place; a failed Aiden task shows Run again on its row, and a pickup says which machine took it.
 */
export function WorkLists(props: ListProps): JSX.Element {
  const { state, account, me, acting, act, openProject } = props;
  const [open, setOpen] = useState<string | null>(null);
  const picked = usePickedUp(state);
  const { yours, agent } = workLists(state, me);
  /** Open one row at a time. */
  const rowProps = (task: AccountTask) => ({
    title: task.title,
    open: open === task.id,
    onToggle: () => setOpen(toggle(open, task.id)),
  });
  return (
    <div className="work-lists">
      <section className="work-card" aria-label="Your tasks">
        <div className="work-card-head">
          <span>Your tasks</span>
          <span className="work-count">{yours.length}</span>
        </div>
        {!yours.length && <p className="work-empty">Nothing for you right now.</p>}
        {yours.map((task) =>
          task.actor === 'agent' && reviewing(task) ? (
            <Row
              key={task.id}
              {...rowProps(task)}
              title={agentKind(task).title}
              tag={agentKind(task).tag}
              sub={`${projectName(state, task)} · ${task.status === 'review' ? 'Ready for your review' : 'Approved. Check what only a person can'}`}
              picked={false}
            >
              {task.status === 'review' ? (
                <ReviewDetail task={task} account={account} onOpen={openProject} />
              ) : (
                <VerifyDetail task={task} account={account} />
              )}
            </Row>
          ) : (
            <Row key={task.id} {...rowProps(task)} sub={cardLine(state, task)} picked={false}>
              <HumanTaskDetail task={task} account={account} onOpen={openProject} />
            </Row>
          ),
        )}
      </section>
      <section className="work-card" aria-label="Agent tasks">
        <div className="work-card-head">
          <span>Agent tasks</span>
          <span className="work-count">{agent.length}</span>
        </div>
        {!agent.length && <p className="work-empty">Aiden has nothing to do right now.</p>}
        {agent.map((task) => {
          const justPicked = picked.has(task.id);
          const kind = agentKind(task);
          return (
            <Row
              key={task.id}
              {...rowProps(task)}
              title={kind.title}
              tag={kind.tag}
              sub={justPicked ? `Picked up by ${machine(state, task)}` : cardLine(state, task)}
              standing={standing(task)}
              picked={justPicked}
              inline={
                task.status === 'failed' ? (
                  <button
                    className="work-solid work-inline"
                    disabled={acting === task.id}
                    onClick={() => act(task, 'rerun')}
                  >
                    Run again
                  </button>
                ) : undefined
              }
            >
              <AgentDetail task={task} {...props} />
            </Row>
          );
        })}
      </section>
    </div>
  );
}
