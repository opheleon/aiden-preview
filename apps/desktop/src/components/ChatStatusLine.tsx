import { Check } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { SetupProgress } from '../../../../packages/contracts/src/guide';
import type { Workspace } from '../hooks/useWorkspace';
import { activeTitles } from '../renderer/run-labels';
import { activeRunIds } from './GuideRunStatus';
import { RunTail } from './RunTail';
import { SetupSteps, setupSummary } from './SetupChecklist';
import { TaskChip } from './TaskTags';
import { describeTeamTask, type TeamTask, useTeamTask } from './TeamTaskStatus';

/** What the line leads with: work under way, a team task that ended, or nothing. */
interface Work {
  title: string;
  sub: string;
  tone: 'live' | 'wait' | 'ended';
  /** Whether the title is this machine's check, announced as project work in progress. */
  local: boolean;
}

/**
 * The work to lead with. A check running here wins; otherwise a team project's Aiden task.
 * Example: two checks at once read "2 checks running".
 */
function leadWork(workspace: Workspace, team: TeamTask): Work | null {
  const ids = activeRunIds(workspace);
  const teamLine = team.state && team.task ? describeTeamTask(team.state, team.task) : '';
  if (ids.length > 1)
    return { title: `${ids.length} checks running`, sub: teamLine, tone: 'live', local: true };
  if (ids.length === 1 || workspace.busy) {
    const run = workspace.runs.find((item) => item.id === ids[0]);
    const title = run ? activeTitles[run.kind] : 'Starting the check';
    return { title, sub: teamLine, tone: 'live', local: true };
  }
  if (!team.task) return null;
  const tone = team.task.status === 'leased' ? 'live' : team.unfinished ? 'wait' : 'ended';
  return { title: team.task.title, sub: teamLine, tone, local: false };
}

/** The lead of the line: a dot, the work, its single Stop or Try again, and why it waits. */
function WorkPart({
  work,
  team,
  canStop,
  onStop,
}: {
  work: Work;
  team: TeamTask;
  canStop: boolean;
  onStop: () => void;
}): JSX.Element {
  return (
    <>
      <span className={`chat-status-dot chat-status-dot--${work.tone}`} aria-hidden="true" />
      {work.local ? (
        <p
          className="guide-thinking chat-status-work"
          role="status"
          aria-label="Project work in progress"
        >
          <span>{work.title}</span>
        </p>
      ) : (
        <p className="chat-status-work">{work.title}</p>
      )}
      {canStop && (
        <button className="text-button" disabled={team.working} onClick={onStop}>
          Stop
        </button>
      )}
      {work.tone === 'ended' && (
        <button className="text-button" disabled={team.working} onClick={() => void team.retry()}>
          Try again
        </button>
      )}
      {work.sub && (
        <span className="chat-status-sub" title={work.sub}>
          {work.sub}
        </span>
      )}
    </>
  );
}

/** Where setup stands, the next step while nothing runs, and the toggle for every step. */
function SetupPart({
  summary,
  idle,
  team,
  open,
  onToggle,
}: {
  summary: ReturnType<typeof setupSummary>;
  idle: boolean;
  /** A team project, where Aiden's own step is the work itself and its detail would repeat. */
  team: boolean;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { next } = summary;
  const detail = next && !(team && next.who === 'Aiden') ? next.detail : '';
  return (
    <>
      <p className="chat-status-setup" role="status" aria-label="Setup status">
        {!next && <Check size={13} aria-hidden="true" />}
        {summary.label}
      </p>
      {idle && next && (
        <span className="chat-status-sub">
          <TaskChip who={next.who} /> {next.label}
          {detail && ` · ${detail}`}
        </span>
      )}
      <button className="text-button chat-status-toggle" aria-expanded={open} onClick={onToggle}>
        {open ? 'Hide steps' : 'Show steps'}
      </button>
    </>
  );
}

/** Show or hide the log, once the project has a run to show. */
function LogToggle({
  shown,
  open,
  onToggle,
}: {
  shown: boolean;
  open: boolean;
  onToggle: () => void;
}): JSX.Element | null {
  if (!shown) return null;
  return (
    <button className="text-button chat-status-log" aria-expanded={open} onClick={onToggle}>
      {open ? 'Hide log' : 'Show log'}
    </button>
  );
}

/** The log above the line: the run in progress, or the latest one once nothing runs. */
function LogTail({ workspace, ids }: { workspace: Workspace; ids: string[] }): JSX.Element | null {
  const run = workspace.runs.find((item) => item.id === ids[0]) ?? workspace.runs[0];
  return run ? <RunTail workspace={workspace} run={run} active={ids.includes(run.id)} /> : null;
}

/**
 * One slim line above the composer: what Aiden is doing, why a team task waits, where setup
 * stands, and the single Stop (or Try again) for this project. Setup steps and the full reason
 * open from it on demand, so the thread keeps the space.
 */
export function ChatStatusLine({
  workspace,
  setup,
}: {
  workspace: Workspace;
  setup: SetupProgress | undefined;
}): JSX.Element | null {
  const team = useTeamTask(workspace);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState(false);
  const work = leadWork(workspace, team);
  const summary = setup ? setupSummary(setup) : null;
  if (!work && !summary) return null;
  const ids = activeRunIds(workspace);
  /** Stop this project's work: the team task (which stops the run here too), or each check. */
  const stop = () => {
    if (team.unfinished) void team.stop();
    else
      void workspace.action(async () => {
        for (const id of ids) await workspace.call('cancel', { runId: id });
      });
  };
  return (
    <section className="chat-status" aria-label="Project status">
      {log && <LogTail workspace={workspace} ids={ids} />}
      <div className="chat-status-line">
        {work && (
          <WorkPart
            work={work}
            team={team}
            canStop={team.unfinished || ids.length > 0}
            onStop={stop}
          />
        )}
        {summary && (
          <SetupPart
            summary={summary}
            idle={!work}
            team={!!workspace.project.account}
            open={open}
            onToggle={() => setOpen(!open)}
          />
        )}
        <LogToggle shown={workspace.runs.length > 0} open={log} onToggle={() => setLog(!log)} />
      </div>
      {team.error && (
        <p className="error" role="alert">
          {team.error}
        </p>
      )}
      {open && work?.sub && <p className="chat-status-reason">{work.sub}</p>}
      {open && setup && <SetupSteps setup={setup} working={workspace.busy} />}
    </section>
  );
}
