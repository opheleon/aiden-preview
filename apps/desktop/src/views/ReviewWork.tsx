import { type JSX, useState } from 'react';

import type { AccountTask, TaskCheck } from '../../../../packages/contracts/src/accounts-api';
import type { AccountView } from '../hooks/useAccount';
import { pullRequests } from './WorkCard';

/** Plain words for a check's state; a manual check still pending is waiting on the reviewer. */
function stateWord(check: TaskCheck): string {
  if (check.state === 'passed') return 'Passed';
  if (check.state === 'failed') return 'Failed';
  return check.kind === 'manual' ? 'Needs you' : 'Running';
}

/**
 * One button per pull request; several name their repository so each is clear. Quiet buttons sit
 * beside a stronger action, such as Approve.
 */
export function PullRequestButtons({
  task,
  quiet = false,
}: {
  task: AccountTask;
  quiet?: boolean;
}): JSX.Element {
  return (
    <>
      {pullRequests(task).map((url, _, all) => (
        <button
          key={url}
          className={`${quiet ? 'work-soft' : 'work-solid'} work-pr`}
          title={url}
          onClick={() => void window.aiden?.openExternal(url)}
        >
          {all.length === 1 ? 'Open pull request' : `Open ${url.split('/')[4]} PR`}
        </button>
      ))}
    </>
  );
}

/**
 * The checks on reviewed work, one per line with its state and Aiden's finding. When `onMark` is
 * given, a manual check still pending gets Pass and Fail buttons for the reviewer.
 */
export function CheckList({
  task,
  working,
  onMark,
}: {
  task: AccountTask;
  working: boolean;
  onMark?: (check: TaskCheck, passed: boolean) => void;
}): JSX.Element | null {
  if (!task.checks.length) return null;
  return (
    <ul className="work-checks" aria-label="Checks">
      {task.checks.map((check) => (
        <li key={check.id} className="work-check">
          <span className={`work-check-state work-check-state--${check.state}`}>
            {stateWord(check)}
          </span>
          <span className="work-check-text">
            <span className="work-check-name">{check.name}</span>
            {check.detail && <span className="work-check-detail">{check.detail}</span>}
          </span>
          {onMark && check.kind === 'manual' && check.state === 'pending' ? (
            <span className="work-check-actions">
              <button
                className="work-soft"
                aria-label={`Pass: ${check.name}`}
                disabled={working}
                onClick={() => onMark(check, true)}
              >
                Pass
              </button>
              <button
                className="work-soft"
                aria-label={`Fail: ${check.name}`}
                disabled={working}
                onClick={() => onMark(check, false)}
              >
                Fail
              </button>
            </span>
          ) : (
            check.url && (
              <button
                className="text-button work-check-link"
                aria-label={`Open: ${check.name}`}
                onClick={() => void window.aiden?.openExternal(check.url!)}
              >
                Open
              </button>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Aiden's finished work waiting for this reviewer: its summary, the pull requests, the checks it
 * will have to pass, and Approve or Request changes. Asking for changes needs a short note, which
 * the fix task carries; approving starts the checks.
 */
export function ReviewDetail({
  task,
  account,
  onOpen,
}: {
  task: AccountTask;
  account: AccountView;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState('');
  return (
    <>
      {task.review?.summary && (
        <p className="work-note work-note--lines">{task.review.summary.replace(/\n{2,}/g, '\n')}</p>
      )}
      <CheckList task={task} working={account.working} />
      <div className="work-actions">
        <PullRequestButtons task={task} quiet />
      </div>
      {changing ? (
        <form
          className="work-answer"
          onSubmit={(event) => {
            event.preventDefault();
            void account.review(task.id, 'changes', note.trim());
          }}
        >
          <input
            aria-label={`What needs to change: ${task.title}`}
            placeholder="What needs to change"
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="work-solid" disabled={account.working || !note.trim()}>
            Send
          </button>
          <button type="button" className="text-button" onClick={() => setChanging(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="work-actions">
          <button
            className="work-solid"
            disabled={account.working}
            onClick={() => void account.review(task.id, 'approve')}
          >
            Approve
          </button>
          <button
            className="work-soft"
            disabled={account.working}
            onClick={() => setChanging(true)}
          >
            Request changes
          </button>
          <button className="text-button" onClick={() => onOpen(task.projectId)}>
            Open project
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Approved work whose checks are running: each check with its state, and Pass or Fail for the
 * manual checks only a person can settle. The task finishes on its own once every check passed, or
 * as soon as one fails.
 */
export function VerifyDetail({
  task,
  account,
}: {
  task: AccountTask;
  account: AccountView;
}): JSX.Element {
  const running = task.checks.filter((c) => c.kind === 'automated' && c.state === 'pending');
  return (
    <>
      {running.length > 0 && (
        <p className="work-note">
          {running.length === 1
            ? 'One automated check is'
            : `${running.length} automated checks are`}{' '}
          still running. Aiden updates them when they finish.
        </p>
      )}
      <CheckList
        task={task}
        working={account.working}
        onMark={(check, passed) => void account.check(task.id, check.id, passed)}
      />
      <div className="work-actions">
        <PullRequestButtons task={task} quiet />
      </div>
    </>
  );
}
