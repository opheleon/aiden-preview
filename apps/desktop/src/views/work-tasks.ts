import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';
import type { Project } from '../../../../packages/contracts/src/index';
import { describeTeamTask, lastError, taskNote } from '../components/TeamTaskStatus';
import { memberName, projectName } from './WorkCard';

/** What a person can do to an Aiden task from Work. */
export type TaskAction = 'stop' | 'rerun' | 'dismiss';

/** Where an Aiden task stands, as the word its row ends with. */
export type AgentStanding = 'Running' | 'Failed' | 'In review' | 'Waiting' | 'Done';

/** The tag for each kind of Aiden work; any other kind shows its own name. */
const kindTags: Record<string, string> = {
  build: 'Build',
  'check-code': 'Check',
  'write-requirements': 'Requirements',
};

/**
 * The tag an Aiden row shows for its kind of work, and its title without that same word in front.
 * Example: kind "build" titled "Build: Reach help from the footer" reads "Reach help from the
 * footer" with a Build tag; a "check-code" task titled "Morning check" keeps its title, tagged Check.
 */
export function agentKind(task: AccountTask): { tag: string; title: string } {
  const named = task.kind.replace(/[-_]+/g, ' ');
  const tag = kindTags[task.kind] ?? named.charAt(0).toUpperCase() + named.slice(1);
  const prefix = `${tag}: `;
  return {
    tag,
    title: task.title.startsWith(prefix) ? task.title.slice(prefix.length) : task.title,
  };
}

/** Work Aiden hands back for a person to look over before it counts. */
export const reviewKinds = new Set(['review-pr', 'setup-confirm']);

/** How a finished, failed, or stopped task ended, for History. */
export type Outcome = 'Done' | 'Failed' | 'Stopped';

/** Whether Aiden's work waits on its reviewer: to review it, or to verify what only a person can. */
export function reviewing(task: AccountTask): boolean {
  return task.status === 'review' || task.status === 'verify';
}

/** Most recently changed first. */
const newest = (a: AccountTask, b: AccountTask) => b.updatedAt.localeCompare(a.updatedAt);
/** Longest waiting first. */
const oldest = (a: AccountTask, b: AccountTask) => a.queuedAt.localeCompare(b.queuedAt);

/** The machine a task ran or runs on, and whose it is. */
export function machine(state: AccountState, task: AccountTask): string {
  const device = state.devices.find((d) => d.deviceId === task.leasedDeviceId);
  return device ? `${device.name} (${memberName(state, device.owner)})` : 'A teammate’s machine';
}

/** How many tries a task has had. */
function tries(task: AccountTask): string {
  return task.attempts === 1 ? '1 try' : `${task.attempts} tries`;
}

/** Where an Aiden task stands: running, failed, done, or waiting for a machine or an answer. */
export function standing(task: AccountTask): AgentStanding {
  if (task.status === 'leased') return 'Running';
  if (task.status === 'review' || task.status === 'verify') return 'In review';
  if (task.status === 'failed') return 'Failed';
  if (task.status === 'done') return 'Done';
  return 'Waiting';
}

/** The order Aiden's rows show in: what is moving, then what needs a decision, then the rest. */
const standingOrder: AgentStanding[] = ['Running', 'Failed', 'In review', 'Waiting', 'Done'];

/**
 * The team's state with every project closed on this computer marked closed too. Closing a team
 * project is saved only on the computer that closed it, so the team still lists it as active.
 * Example: a Zoom project closed here keeps its failed Morning checks out of Active.
 */
export function withClosedHere(state: AccountState, projects: readonly Project[]): AccountState {
  const closed = new Set(projects.filter((p) => p.lifecycle?.status === 'closed').map((p) => p.id));
  if (!state.projects.some((p) => p.status === 'active' && closed.has(p.id))) return state;
  return {
    ...state,
    projects: state.projects.map((p) => (closed.has(p.id) ? { ...p, status: 'closed' } : p)),
  };
}

/**
 * Work's two lists, leaving out closed projects. Your tasks: your questions, reviews, and to-dos,
 * longest waiting first. Agent tasks: Aiden's work that is running, failed (only the latest try of
 * the same work), waiting, or done today, in that order.
 */
export function workLists(
  state: AccountState,
  me: string | null,
): { yours: AccountTask[]; agent: AccountTask[] } {
  const today = new Date().toDateString();
  // A closed project's work waits until someone reopens it, so it stays in History, not here.
  const closed = new Set(state.projects.filter((p) => p.status === 'closed').map((p) => p.id));
  const open = state.tasks.filter((t) => !closed.has(t.projectId));
  const yours = open
    .filter(
      (t) =>
        (t.actor === 'human' &&
          t.status === 'queued' &&
          (t.assigneeUserId === null || t.assigneeUserId === me)) ||
        // Aiden's finished work the team picked you to review, then to verify.
        (t.actor === 'agent' && reviewing(t) && t.reviewerUserId === me),
    )
    .sort(oldest);
  const agent = open
    .filter(
      (t) =>
        t.actor === 'agent' &&
        (['leased', 'blocked', 'review', 'verify', 'queued'].includes(t.status) ||
          // An older failure of work that ran again since stays in History, not here.
          (t.status === 'failed' && !rerunOf(state, t)) ||
          (t.status === 'done' && new Date(t.updatedAt).toDateString() === today)),
    )
    .sort(
      (a, b) =>
        standingOrder.indexOf(standing(a)) - standingOrder.indexOf(standing(b)) ||
        (standing(a) === 'Done' ? newest(a, b) : oldest(a, b)),
    );
  return { yours, agent };
}

/**
 * The short line under a row's title, starting with its project. Example: a paused Aiden task
 * reads "Billing · Waits on your answer", and its question "Billing · Aiden is paused until you
 * answer".
 */
export function cardLine(state: AccountState, task: AccountTask): string {
  const project = projectName(state, task);
  if (task.actor === 'human') {
    const paused = state.tasks.some((t) => t.status === 'blocked' && t.blockedBy === task.id);
    return paused ? `${project} · Aiden is paused until you answer` : project;
  }
  // Every Aiden row names its project, so the same kind of work on two projects reads apart.
  const detail = agentLine(state, task);
  return detail ? `${project} · ${detail}` : project;
}

/** What an Aiden row says after its project: where it runs, why it waits, or how it ended. */
function agentLine(state: AccountState, task: AccountTask): string | null | undefined {
  const error = lastError(task);
  if (task.status === 'leased') return machine(state, task);
  if (reviewing(task)) return describeTeamTask(state, task);
  if (task.status === 'blocked') return 'Waits on your answer';
  if (task.status === 'failed') return `Failed after ${tries(task)}${error ? ` · ${error}` : ''}`;
  if (task.status !== 'queued') return taskNote(task);
  return task.attempts && error ? `Tried ${tries(task)} · ${error}` : task.waiting;
}

/**
 * How a task ended. A cancelled task that had failed (its error is kept) still reads Failed after
 * someone dismissed it; one cancelled with no error was stopped by a person.
 */
export function outcome(task: AccountTask): Outcome | null {
  if (task.status === 'done') return 'Done';
  if (task.status === 'failed') return 'Failed';
  if (task.status === 'cancelled') return lastError(task) ? 'Failed' : 'Stopped';
  return null;
}

/** The later run of the same Aiden work, when someone ran this task again. */
export function rerunOf(state: AccountState, task: AccountTask): AccountTask | null {
  return (
    state.tasks.find(
      (t) =>
        t.id !== task.id &&
        t.actor === task.actor &&
        t.projectId === task.projectId &&
        t.kind === task.kind &&
        t.title === task.title &&
        t.queuedAt > task.queuedAt,
    ) ?? null
  );
}

/** A day's heading in History: Today, Yesterday, or the date. */
function dayLabel(at: Date): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (at.toDateString() === new Date().toDateString()) return 'Today';
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return at.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The ids of the team's closed projects. */
function closedIds(state: AccountState): Set<string> {
  return new Set(state.projects.filter((p) => p.status === 'closed').map((p) => p.id));
}

/** Every task of an open project that ended, newest first, grouped by the day it ended. */
export function historyDays(state: AccountState): { day: string; tasks: AccountTask[] }[] {
  const closed = closedIds(state);
  const days: { day: string; tasks: AccountTask[] }[] = [];
  const ended = state.tasks.filter((t) => outcome(t) && !closed.has(t.projectId));
  for (const task of ended.sort(newest)) {
    const day = dayLabel(new Date(task.updatedAt));
    const last = days.at(-1);
    if (last?.day === day) last.tasks.push(task);
    else days.push({ day, tasks: [task] });
  }
  return days;
}

/**
 * Every task of a closed project, finished or held, newest first. History keeps them in one
 * folded group at the bottom, so closed work is kept but out of the way.
 */
export function closedProjectTasks(state: AccountState): AccountTask[] {
  const closed = closedIds(state);
  return state.tasks.filter((t) => closed.has(t.projectId)).sort(newest);
}
