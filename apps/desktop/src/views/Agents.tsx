import { Clock, Laptop, ShieldCheck } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { useAccount } from '../hooks/useAccount';
import type { Workspace } from '../hooks/useWorkspace';
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

/** Whose agent ran a task, by the machine it ran on. */
function ranBy(state: AccountState, task: AccountTask): string {
  const device = state.devices.find((d) => d.deviceId === task.leasedDeviceId);
  return device ? `${memberName(state, device.owner)}’s agent` : 'An agent';
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

/**
 * Agents: every teammate's agent and what it is on, the work waiting for a machine with room, and
 * what finished today. Rows are one line; a teammate's agent opens to show where it runs.
 */
export function Agents({ workspace }: { workspace: Workspace }): JSX.Element {
  const account = useAccount(workspace.call);
  const [open, setOpen] = useState<string | null>(null);
  const { state } = account;
  const today = new Date().toDateString();
  const agents = state
    ? state.devices.map((device) => ({ device, ...agentState(state, device) }))
    : [];
  const working = agents.filter((a) => a.word === 'Running').length;
  const waitingOnYou = agents.filter((a) => a.word === 'Waiting on you').length;
  const queued = (state?.tasks ?? []).filter((t) => t.actor === 'agent' && t.status === 'queued');
  const finished = (state?.tasks ?? [])
    .filter(
      (t) =>
        t.actor === 'agent' &&
        (t.status === 'done' || t.status === 'failed') &&
        new Date(t.updatedAt).toDateString() === today,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  /** Open a task's project in the project view. */
  const openProject = (projectId: string) =>
    void workspace.load(projectId).then(() => workspace.setArea('projects'));
  const lede = !agents.length
    ? 'No machines are picking up work. Work waits until someone opens Aiden.'
    : `${working === 1 ? 'One agent is' : `${working || 'No'} agents are`} working on your team’s machines.${
        waitingOnYou
          ? ` ${waitingOnYou === 1 ? 'One is' : `${waitingOnYou} are`} waiting on you.`
          : ''
      }`;
  return (
    <div className="content work-view">
      <header className="work-header">
        <h1>Agents</h1>
        {state && <p className="work-lede">{lede}</p>}
      </header>
      {account.error && (
        <p className="error" role="alert">
          {account.error}
        </p>
      )}
      {!state ? (
        <p className="work-empty">Loading your team…</p>
      ) : (
        <>
          <WorkCard
            icon={<Laptop size={16} aria-hidden="true" />}
            title="Your team’s agents"
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
                  title={doing}
                  sub={`${device.name} · ${owner}’s agent · ${word}`}
                  meta={task ? projectName(state, task) : `Seen ${when(device.lastSeenAt)}`}
                  open={open === device.deviceId}
                  onToggle={() => setOpen(toggle(open, device.deviceId))}
                >
                  <AgentDetail device={device} task={task} word={word} onOpen={openProject} />
                </WorkRow>
              );
            })}
          </WorkCard>
          <WorkCard
            icon={<Clock size={16} aria-hidden="true" />}
            title="Waiting for room"
            count={queued.length}
            empty="Nothing waiting. Every task has a machine."
          >
            {queued.map((task) => (
              <WorkRow
                key={task.id}
                lead={<WorkDot dot="quiet" />}
                title={task.title}
                sub={task.waiting ?? task.progress ?? 'The next machine with room picks it up'}
                meta={projectName(state, task)}
                open={open === task.id}
                onToggle={() => setOpen(toggle(open, task.id))}
              >
                <div className="work-actions">
                  <button className="work-soft" onClick={() => openProject(task.projectId)}>
                    Open project
                  </button>
                </div>
              </WorkRow>
            ))}
          </WorkCard>
          <WorkCard
            icon={<ShieldCheck size={16} aria-hidden="true" />}
            title="Finished today"
            count={finished.length}
            empty="Nothing finished yet today."
          >
            {finished.map((task) => (
              <WorkRow
                key={task.id}
                lead={<WorkDot dot={task.status === 'done' ? 'brand' : 'warn'} />}
                title={task.title}
                sub={`${ranBy(state, task)} · ${projectName(state, task)}`}
                meta={task.status === 'done' ? `Done ${when(task.updatedAt)}` : 'Stopped'}
                open={open === task.id}
                onToggle={() => setOpen(toggle(open, task.id))}
              >
                {task.status === 'failed' && (
                  <p className="work-note">Stopped after {task.attempts} tries.</p>
                )}
                <div className="work-actions">
                  <button className="work-soft" onClick={() => openProject(task.projectId)}>
                    Open project
                  </button>
                </div>
              </WorkRow>
            ))}
          </WorkCard>
        </>
      )}
    </div>
  );
}
