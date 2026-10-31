import type { JSX } from 'react';

import type { AccountState, AccountTask } from '../../../../packages/contracts/src/accounts-api';

/** How a row's dot reads: now, waiting, needs another look, or quiet. */
export type Dot = 'brand' | 'live' | 'warn' | 'quiet';

/** The colored dot that leads a row. */
export function WorkDot({ dot }: { dot: Dot }): JSX.Element {
  return <span className={`work-dot work-dot--${dot}`} aria-hidden="true" />;
}

/** The project a task belongs to. */
export function projectName(state: AccountState, task: AccountTask): string {
  return state.projects.find((p) => p.id === task.projectId)?.name ?? 'Project';
}

/** A member's name from their email, falling back to the part before the @. */
export function memberName(state: AccountState, email: string): string {
  return state.members.find((m) => m.email === email)?.name || email.split('@')[0] || email;
}

/** When something happened: the time today, or the date before today. */
export function when(iso: string): string {
  const at = new Date(iso);
  return at.toDateString() === new Date().toDateString()
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A task's text without markdown marks or PR links (those get their own buttons). */
export function summary(task: AccountTask): string {
  return task.instructions
    .replace(/https:\/\/github\.com\/\S+\/pull\/\d+/g, '')
    .replace(/[#*`]+/g, '')
    .trim();
}

/** The GitHub pull requests a task points at: its review packet's, or those in its text. */
export function pullRequests(task: AccountTask): string[] {
  if (task.review?.pullRequestUrls.length) return task.review.pullRequestUrls;
  return task.instructions.match(/https:\/\/github\.com\/\S+\/pull\/\d+/g) ?? [];
}

/**
 * How finished Aiden work ended, in a word: reviewed work says whether its checks passed or the
 * reviewer asked for changes; anything else is simply done.
 */
export function finishedWord(task: AccountTask): string {
  if (task.verification === 'passed') return 'Verified';
  if (task.verification === 'failed') return 'Checks failed';
  if (task.verification === 'changes_requested') return 'Changes requested';
  return 'Done';
}

/** One row open at a time: toggling the open one closes it. */
export function toggle(open: string | null, id: string): string | null {
  return open === id ? null : id;
}
