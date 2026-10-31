import { RefreshCw } from 'lucide-react';
import { type JSX, useMemo, useState } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { pickupHint } from '../components/TeamTaskStatus';
import { useAccount } from '../hooks/useAccount';
import type { Workspace } from '../hooks/useWorkspace';
import { type TaskAction, withClosedHere, workLists } from './work-tasks';
import { type Dot, memberName, WorkDot } from './WorkCard';
import { WorkHistory } from './WorkHistory';
import { WorkLists } from './WorkLists';

/** A machine not heard from in this long counts as away (closed laptop, Aiden quit). */
const awayMs = 10 * 60_000;

type Device = AccountState['devices'][number];

/** Good morning, afternoon, or evening. */
function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  // A member with no name set shows as their email; greet them without it.
  const first = name.includes('@') ? '' : name.split(' ')[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

/** Where one teammate's machine stands, as a word and a dot. Example: "Running", live. */
function machineState(state: AccountState, device: Device): { word: string; dot: Dot } {
  /** Whether this machine has an Aiden task in this status. */
  const on = (status: AccountTask['status']) =>
    state.tasks.some(
      (t) => t.actor === 'agent' && t.status === status && t.leasedDeviceId === device.deviceId,
    );
  if (on('leased')) return { word: 'Running', dot: 'live' };
  if (on('blocked')) return { word: 'Waiting on an answer', dot: 'brand' };
  if (Date.now() - new Date(device.lastSeenAt).getTime() > awayMs)
    return { word: 'Away', dot: 'quiet' };
  if (!device.pickupEnabled) return { word: 'Not taking team work', dot: 'quiet' };
  return { word: 'Ready', dot: 'live' };
}

/** The opening line: how many tasks are yours, how much runs, and how many machines are ready. */
function lede(state: AccountState, me: string | null): string {
  const { yours, agent } = workLists(state, me);
  const running = agent.filter((t) => t.status === 'leased').length;
  const forYou = `${yours.length} ${yours.length === 1 ? 'task' : 'tasks'} for you`;
  const hint = pickupHint(state);
  if (hint) return `${forYou}. No machines are picking up work, so Aiden's work waits. ${hint}`;
  const ready = state.devices.filter((d) => machineState(state, d).word === 'Ready').length;
  return `${forYou}, ${running} running, ${ready} ${ready === 1 ? 'machine' : 'machines'} ready.`;
}

/**
 * Work: one place for you and Aiden. The Active tab has two lists, Your tasks and Agent tasks;
 * History keeps everything that ended. The team's machines sit in the header.
 */
export function Work({ workspace }: { workspace: Workspace }): JSX.Element {
  const account = useAccount(workspace.call);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [acting, setActing] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const { projects } = workspace;
  const state = useMemo(
    () => account.state && withClosedHere(account.state, projects),
    [account.state, projects],
  );
  const me = account.status?.userId ?? null;
  const name = state?.members.find((m) => m.id === me)?.name ?? '';
  /** Open a task's project in the project view. */
  const openProject = (projectId: string) =>
    void workspace.load(projectId).then(() => workspace.setArea('projects'));
  /** Stop, rerun, or dismiss an Aiden task for the whole team, then show the new state. */
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
  const error = failure || account.error;
  return (
    <div className="content work-view">
      <header className="work-header">
        <div className="work-heading">
          <h1>{greeting(name)}</h1>
          <button
            className="work-refresh"
            aria-label="Refresh"
            title="Refresh"
            disabled={account.working}
            onClick={() => void account.reload()}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
        {state && <p className="work-lede">{lede(state, me)}</p>}
        {state && state.devices.length > 0 && (
          <ul className="work-machines" aria-label="Machines">
            {state.devices.map((device) => {
              const { word, dot } = machineState(state, device);
              const owner = memberName(state, device.owner);
              return (
                <li key={device.deviceId} className="work-machine" title={`${owner} · ${word}`}>
                  <span className="work-avatar" aria-hidden="true">
                    {owner[0]?.toUpperCase()}
                    <WorkDot dot={dot} />
                  </span>
                  {device.name} · {word}
                </li>
              );
            })}
          </ul>
        )}
      </header>
      <div className="work-tabs" role="tablist" aria-label="Work">
        {(['active', 'history'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'work-tab active' : 'work-tab'}
            onClick={() => setTab(id)}
          >
            {id === 'active' ? 'Active' : 'History'}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!state ? (
        <p className="work-empty">Loading your work…</p>
      ) : tab === 'active' ? (
        <WorkLists
          state={state}
          account={account}
          me={me}
          acting={acting}
          act={act}
          openProject={openProject}
        />
      ) : (
        <WorkHistory state={state} acting={acting} act={act} openProject={openProject} />
      )}
    </div>
  );
}
