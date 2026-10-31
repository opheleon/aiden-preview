import { type JSX, useState } from 'react';

import type { AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { setupStepOf } from '../../../../packages/contracts/src/task-model';
import type { AccountView } from '../hooks/useAccount';
import { reviewKinds } from './work-tasks';
import { pullRequests, summary } from './WorkCard';

/** A task's text, kept short. */
function Detail({ task }: { task: AccountTask }): JSX.Element | null {
  const text = summary(task);
  return text ? <p className="work-note">{text}</p> : null;
}

/** Setup steps finish in the project; anything else is marked done here. */
function Finish({
  task,
  account,
  onOpen,
}: {
  task: AccountTask;
  account: AccountView;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  return setupStepOf(task.kind) ? (
    <button className="work-solid" onClick={() => onOpen(task.projectId)}>
      Open project
    </button>
  ) : (
    <>
      <button
        className="work-soft"
        disabled={account.working}
        onClick={() => void account.finish(task.id)}
      >
        Mark done
      </button>
      <button className="text-button" onClick={() => onOpen(task.projectId)}>
        Open project
      </button>
    </>
  );
}

/** A question from Aiden: the context, then an answer that lets the paused work pick back up. */
function Question({ task, account }: { task: AccountTask; account: AccountView }): JSX.Element {
  const [answer, setAnswer] = useState('');
  return (
    <>
      <Detail task={task} />
      <form
        className="work-answer"
        onSubmit={(event) => {
          event.preventDefault();
          void account.finish(task.id, answer);
        }}
      >
        <input
          aria-label={`Answer: ${task.title}`}
          placeholder="Your answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <button className="work-solid" disabled={account.working || !answer.trim()}>
          Send
        </button>
      </form>
    </>
  );
}

/**
 * What an open card offers for a person's task: an answer for a question, the pull requests and
 * Mark done for a review, and Mark done or Open project for anything else.
 */
export function HumanTaskDetail({
  task,
  account,
  onOpen,
}: {
  task: AccountTask;
  account: AccountView;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  if (task.kind === 'answer') return <Question task={task} account={account} />;
  const review = reviewKinds.has(task.kind);
  return (
    <>
      <Detail task={task} />
      <div className="work-actions">
        {review &&
          pullRequests(task).map((url, _, all) => (
            <button
              key={url}
              className="work-solid"
              onClick={() => void window.aiden?.openExternal(url)}
            >
              {all.length === 1 ? 'Open pull request' : `Open ${url.split('/')[4]} PR`}
            </button>
          ))}
        <Finish task={task} account={account} onOpen={onOpen} />
      </div>
    </>
  );
}
