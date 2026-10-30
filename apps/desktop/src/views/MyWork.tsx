import { ArrowRight, CircleHelp, GitPullRequest, RefreshCw, ShieldCheck } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { AccountTask } from '../../../../packages/contracts/src/accounts-api';
import { setupStepOf } from '../../../../packages/contracts/src/task-model';
import { type AccountView, useAccount } from '../hooks/useAccount';
import type { Workspace } from '../hooks/useWorkspace';
import { PullRequestButtons, ReviewDetail, VerifyDetail } from './ReviewWork';
import { projectName, summary, toggle, WorkCard, WorkDot, WorkRow } from './WorkCard';

/** Aiden asking a person something: an answer task, or a coding session that paused. */
const questionKinds = new Set(['answer', 'coding-question']);
/**
 * Older work Aiden handed back as a person's task to look over: pull requests from before review
 * packets, and confirming requirements. These still finish with Mark done or in the project.
 */
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
 * My work: what Aiden needs from you, in contained cards. Questions to answer, Aiden's work you
 * review, approved work whose checks you verify, and anything else only a person can do. Rows are
 * one line and open in place. Reviews and checks show only to the reviewer the team picked.
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
  /** Aiden's work in one stage that the team picked me to review. */
  const reviewing = (status: 'review' | 'verify') =>
    (state?.tasks ?? []).filter(
      (t) => t.actor === 'agent' && t.status === status && t.reviewerUserId === me,
    );
  const toReview = reviewing('review');
  const toVerify = reviewing('verify');
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
            icon={<GitPullRequest size={16} aria-hidden="true" />}
            title="To review"
            count={toReview.length}
            empty="Nothing to review."
          >
            {toReview.map((task) => (
              <WorkRow key={task.id} {...row(task, 'brand')}>
                <ReviewDetail task={task} account={account} onOpen={openProject} />
              </WorkRow>
            ))}
          </WorkCard>
          <WorkCard
            icon={<ShieldCheck size={16} aria-hidden="true" />}
            title="To verify"
            count={toVerify.length + reviews.length}
            empty="Nothing to look over."
          >
            {toVerify.map((task) => (
              <WorkRow key={task.id} {...row(task, 'brand')}>
                <VerifyDetail task={task} account={account} />
              </WorkRow>
            ))}
            {reviews.map((task) => (
              <WorkRow key={task.id} {...row(task, 'brand')}>
                <Detail task={task} />
                <div className="work-actions">
                  <PullRequestButtons task={task} />
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
  if (task.kind !== 'answer')
    return (
      <>
        <Detail task={task} />
        <div className="work-actions">
          <Finish task={task} account={account} onOpen={onOpen} />
        </div>
      </>
    );
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
