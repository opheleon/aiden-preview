import { CircleAlert, Clock, Laptop, Play, ShieldCheck } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { useAccount } from '../hooks/useAccount';
import type { Workspace } from '../hooks/useWorkspace';
import {
  finishedLine,
  runningLine,
  stoppedLine,
  type TaskAction,
  TaskCard,
  waitingLine,
} from './AgentTasks';
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

/** A machine not heard from in this long counts as away (closed laptop, Aiden quit). */
const awayMs = 10 * 60_000;

type Device = AccountState['devices'][number];

/** Where one teammate's agent stands: what it is on, and the words and dot for it. */
function agentState(
  state: AccountState,
  device: Device,
): { task: AccountTask | null; doing: string; word: string; dot: Dot } {
  /** This machine's agent task in a given status. */
  const on = (status: AccountTask['status']) =>
    state.tasks.find(
      (t) => t.actor === 'agent' && t.status === status && t.leasedDeviceId === device.deviceId,
    ) ?? null;
  const running = on('leased');
  if (running) return { task: running, doing: running.title, word: 'Running', dot: 'live' };
  const paused = on('blocked');
  if (paused)
    return {
      task: paused,
      doing: paused.title,
      word: 'Waiting on you',
      dot: 'brand',
    };
  if (Date.now() - new Date(device.lastSeenAt).getTime() > awayMs)
    return { task: null, doing: 'Not taking work right now', word: 'Away', dot: 'quiet' };
  if (!device.pickupEnabled)
    return { task: null, doing: 'Not taking team work', word: 'Off', dot: 'quiet' };
  return { task: null, doing: 'Ready for the next task', word: 'Ready', dot: 'live' };
}

/** Where a teammate's agent runs, its latest step, and whether it takes team work. */
function AgentDetail({
  device,
  task,
  word,
  onOpen,
}: {
  device: Device;
  task: AccountTask | null;
  word: string;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  const latest =
    task?.progress ??
    (task ? `${word === 'Running' ? 'Started' : 'Paused'} ${when(task.updatedAt)}` : word);
  return (
    <>
      {word === 'Waiting on you' && (
        <p className="work-note">
          Paused for an answer in My work. It picks back up on this Mac once someone answers.
        </p>
      )}
      <div className="work-facts">
        <div>
          <span>Runs on</span>
          <strong>{device.name}</strong>
        </div>
        <div>
          <span>Latest</span>
          <strong>{latest}</strong>
        </div>
        <div>
          <span>Team work</span>
          <strong>{device.pickupEnabled ? 'Picking up' : 'Paused'}</strong>
        </div>
      </div>
      {task && (
        <div className="work-actions">
          <button className="work-soft" onClick={() => onOpen(task.projectId)}>
            Open project
          </button>
        </div>
      )}
    </>
  );
}

/** The team's agent tasks, sorted into what is running, waiting, stopped, and done today. */
function sortTasks(
  state: AccountState | null,
): Record<'running' | 'waiting' | 'stopped' | 'finished', AccountTask[]> {
  const agent = (state?.tasks ?? []).filter((t) => t.actor === 'agent');
  const today = new Date().toDateString();
  /** Most recently changed first. */
  const newest = (a: AccountTask, b: AccountTask) => b.updatedAt.localeCompare(a.updatedAt);
  return {
    running: agent.filter((t) => t.status === 'leased'),
    waiting: agent.filter((t) => t.status === 'queued' || t.status === 'blocked'),
    stopped: agent.filter((t) => t.status === 'failed').sort(newest),
    finished: agent
      .filter((t) => t.status === 'done' && new Date(t.updatedAt).toDateString() === today)
      .sort(newest),
  };
}

/** The page's opening line: how much is running, waiting, and stopped. */
function lede(machines: number, tasks: ReturnType<typeof sortTasks>): string {
  if (!machines) return 'No machines are picking up work. Work waits until someone opens Aiden.';
  const parts = [
    `${tasks.running.length} running`,
    `${tasks.waiting.length} waiting`,
    ...(tasks.stopped.length ? [`${tasks.stopped.length} stopped`] : []),
  ];
  return `${parts.join(', ')} on your team’s ${machines === 1 ? 'machine' : `${machines} machines`}.`;
}

/**
 * Agents: the team's agent work first (running now, waiting, stopped with Run again and Remove,
 * finished today), then each teammate's machine and what it is on. Rows open in place.
 */
export function Agents({ workspace }: { workspace: Workspace }): JSX.Element {
  const account = useAccount(workspace.call);
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const { state } = account;
  const tasks = sortTasks(state);
  const agents = state
    ? state.devices.map((device) => ({ device, ...agentState(state, device) }))
    : [];
  /** Open a task's project in the project view. */
  const openProject = (projectId: string) =>
    void workspace.load(projectId).then(() => workspace.setArea('projects'));
  /** Stop, rerun, or remove a task for the whole team, then show the new state. */
  const act = (task: AccountTask, action: TaskAction) => {
    setActing(task.id);
    setFailure('');
    const method = action === 'rerun' ? 'accountRetryTask' : 'accountCancelTask';
    void workspace
      .call(method, { taskId: task.id })
      .then(() => account.reload())
      .catch((e: unknown) =>
        setFailure(e instanceof Error ? e.message : 'That did not work. Try again.'),
      )
      .finally(() => setActing(null));
  };
  const page = { open, setOpen, acting, act, openProject };
  const error = failure || account.error;
  return (
    <div className="content work-view">
      <header className="work-header">
        <h1>Agents</h1>
        {state && <p className="work-lede">{lede(state.devices.length, tasks)}</p>}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!state ? (
        <p className="work-empty">Loading your team…</p>
      ) : (
        <>
          <TaskCard
            {...page}
            state={state}
            icon={<Play size={16} aria-hidden="true" />}
            title="Running now"
            empty="Nothing running right now."
            tasks={tasks.running}
            line={runningLine}
          />
          <TaskCard
            {...page}
            state={state}
            icon={<Clock size={16} aria-hidden="true" />}
            title="Waiting"
            empty="Nothing waiting. Every task has a machine."
            tasks={tasks.waiting}
            line={waitingLine}
          />
          {tasks.stopped.length > 0 && (
            <TaskCard
              {...page}
              state={state}
              icon={<CircleAlert size={16} aria-hidden="true" />}
              title="Stopped"
              empty=""
              tasks={tasks.stopped}
              line={stoppedLine}
            />
          )}
          <TaskCard
            {...page}
            state={state}
            icon={<ShieldCheck size={16} aria-hidden="true" />}
            title="Finished today"
            empty="Nothing finished yet today."
            tasks={tasks.finished}
            line={finishedLine}
          />
          <WorkCard
            icon={<Laptop size={16} aria-hidden="true" />}
            title="Machines"
            count={agents.length}
            empty="No machines yet."
          >
            {agents.map(({ device, task, doing, word, dot }) => {
              const owner = memberName(state, device.owner);
              return (
                <WorkRow
                  key={device.deviceId}
                  lead={
                    <span className="work-avatar" aria-hidden="true">
                      {owner[0]?.toUpperCase()}
                      <WorkDot dot={dot} />
                    </span>
                  }
                  title={`${device.name} · ${owner}`}
                  sub={`${word} · ${doing}`}
                  meta={task ? projectName(state, task) : `Seen ${when(device.lastSeenAt)}`}
                  open={open === device.deviceId}
                  onToggle={() => setOpen(toggle(open, device.deviceId))}
                >
                  <AgentDetail device={device} task={task} word={word} onOpen={openProject} />
                </WorkRow>
              );
            })}
          </WorkCard>
        </>
      )}
    </div>
  );
}
