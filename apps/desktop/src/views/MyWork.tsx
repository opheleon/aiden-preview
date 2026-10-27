import { ArrowRight, CircleHelp, RefreshCw, ShieldCheck } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { setupStepOf } from '../../../../packages/contracts/src/task-model';
import { FormattedText } from '../components/FormattedText';
import { type AccountView, useAccount } from '../hooks/useAccount';
import type { Workspace } from '../hooks/useWorkspace';
import { projectName, pullRequests, summary, toggle, WorkCard, WorkDot, WorkRow } from './WorkCard';

/** Aiden asking a person something: an answer task, or a coding session that paused. */
const questionKinds = new Set(['answer', 'coding-question']);
/** Work Aiden hands back for a person to look over before it counts. */
const reviewKinds = new Set(['review-pr', 'setup-confirm']);

/** Good morning, afternoon, or evening. */
function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return name ? `Good ${part}, ${name.split(' ')[0]}` : `Good ${part}`;
}

/** What your own agent is up to, in one line. */
function agentLine(account: AccountView): { live: boolean; text: string } {
  const status = account.status;
  if (status?.running)
    return { live: true, text: `Your agent is working on “${status.running.title}”.` };
  if (status?.pickupEnabled)
    return { live: true, text: status.last?.reason ?? 'Your agent is ready for team work.' };
  return { live: false, text: 'Your agent is not picking up team work.' };
}

/**
 * My work: what Aiden needs from you, in three contained cards. Questions to answer, work to look
 * over, and anything else only a person can do. Rows are one line and open in place.
 */
export function MyWork({ workspace }: { workspace: Workspace }): JSX.Element {
  const account = useAccount(workspace.call);
  const [open, setOpen] = useState<string | null>(null);
  const { state } = account;
  const me = account.status?.userId ?? null;
  const name = state?.members.find((m) => m.id === me)?.name ?? '';
  const mine = (state?.tasks ?? []).filter(
    (t) =>
      t.actor === 'human' &&
      t.status === 'queued' &&
      (t.assigneeUserId === null || t.assigneeUserId === me),
  );
  const questions = mine.filter((t) => questionKinds.has(t.kind));
  const reviews = mine.filter((t) => reviewKinds.has(t.kind));
  const actions = mine.filter((t) => !questionKinds.has(t.kind) && !reviewKinds.has(t.kind));
  const line = agentLine(account);
  /** Open a task's project in the project view. */
  const openProject = (projectId: string) =>
    void workspace.load(projectId).then(() => workspace.setArea('projects'));
  /** The parts every task row shares. */
  const row = (task: AccountTask, dot: 'brand' | 'quiet') => ({
    lead: <WorkDot dot={dot} />,
    title: task.title,
    meta: state ? projectName(state, task) : '',
    open: open === task.id,
    onToggle: () => setOpen(toggle(open, task.id)),
  });
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
        {account.status && (
          <p className="work-lede">
            <WorkDot dot={line.live ? 'live' : 'quiet'} />
            {line.text}
          </p>
        )}
      </header>
      {account.error && (
        <p className="error" role="alert">
          {account.error}
        </p>
      )}
      {!state ? (
        <p className="work-empty">Loading your work…</p>
      ) : (
        <>
          <WorkCard
            icon={<CircleHelp size={16} aria-hidden="true" />}
            title="Questions for you"
            count={questions.length}
            empty="No questions right now."
          >
            {questions.map((task) => (
              <WorkRow key={task.id} {...row(task, 'brand')}>
                <Question task={task} account={account} onOpen={openProject} />
              </WorkRow>
            ))}
          </WorkCard>
          <WorkCard
            icon={<ShieldCheck size={16} aria-hidden="true" />}
            title="To verify"
            count={reviews.length}
            empty="Nothing to look over."
          >
            {reviews.map((task) => (
              <WorkRow key={task.id} {...row(task, 'brand')}>
                <Detail task={task} />
                <div className="work-actions">
                  {pullRequests(task).map((url, _, all) => (
                    <button
                      key={url}
                      className="work-solid"
                      onClick={() => void window.aiden?.openExternal(url)}
                    >
                      {all.length === 1 ? 'Open pull request' : `Open ${url.split('/')[4]} PR`}
                    </button>
                  ))}
                  <Finish task={task} account={account} onOpen={openProject} />
                </div>
              </WorkRow>
            ))}
          </WorkCard>
          <WorkCard
            icon={<ArrowRight size={16} aria-hidden="true" />}
            title="For you to do"
            count={actions.length}
            empty="Nothing for you to do."
          >
            {actions.map((task) => (
              <WorkRow key={task.id} {...row(task, 'quiet')}>
                <Detail task={task} />
                <div className="work-actions">
                  <Finish task={task} account={account} onOpen={openProject} />
                </div>
              </WorkRow>
            ))}
          </WorkCard>
        </>
      )}
    </div>
  );
}

/** A task's full text with its paragraphs and lists; PR links get their own buttons. */
function Detail({ task }: { task: AccountTask }): JSX.Element | null {
  const text = summary(task);
  return text && text !== task.title.trim() ? (
    <FormattedText text={text} className="work-body" />
  ) : null;
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
    <button type="button" className="work-solid" onClick={() => onOpen(task.projectId)}>
      Open project
    </button>
  ) : (
    <>
      <button
        type="button"
        className="work-soft"
        disabled={account.working}
        onClick={() => void account.finish(task.id)}
      >
        Mark done
      </button>
      <button type="button" className="text-button" onClick={() => onOpen(task.projectId)}>
        Open project
      </button>
    </>
  );
}

/**
 * A question from Aiden: the context, then an answer that goes to the team's server. An answer
 * task resumes the paused work with it; a coding question records it for the team, and can also
 * be closed without one when the person took over the session themselves.
 */
function Question({
  task,
  account,
  onOpen,
}: {
  task: AccountTask;
  account: AccountView;
  onOpen: (projectId: string) => void;
}): JSX.Element {
  const [answer, setAnswer] = useState('');
  /** Record the answer on the server; a failed send keeps it for another try. */
  const send = () => {
    if (answer.trim() && !account.working) void account.finish(task.id, answer.trim());
  };
  return (
    <>
      <Detail task={task} />
      <form
        className="work-answer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label={`Answer: ${task.title}`}
          placeholder="Your answer"
          rows={2}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="work-actions">
          <button className="work-solid" disabled={account.working || !answer.trim()}>
            Send
          </button>
          {task.kind === 'coding-question' && (
            <Finish task={task} account={account} onOpen={onOpen} />
          )}
        </div>
      </form>
    </>
  );
}
