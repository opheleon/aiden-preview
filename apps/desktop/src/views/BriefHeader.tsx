import { Square } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import type { LookReason, RunManifest } from '../../../../packages/contracts/src/index';
import { scopeName } from '../../../../packages/contracts/src/project-name';
import { useProjectGuide } from '../components/ProjectGuide';
import { ProjectOutcome } from '../components/ProjectOutcome';
import type { CodingDeliveryState } from '../hooks/useCodingDelivery';
import type { Workspace } from '../hooks/useWorkspace';
import { timeAgo } from '../renderer/time';

/**
 * What Aiden is doing right now, with a way to stop it, on every tab but Chat: the chat's own
 * status line says the same there, with the one Stop.
 */
function LiveLine({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const { busy, live, activeRun, action, call } = workspace;
  const { open, tab } = useProjectGuide();
  if (!busy || tab === 'chat') return null;
  return (
    <p className="live-line" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {live || 'Aiden is working.'}
      {activeRun && (
        <button className="text-button" onClick={() => open({ type: 'run' })}>
          Show progress
        </button>
      )}
      {activeRun && (
        <button
          className="text-button"
          onClick={() => void action(async () => void (await call('cancel', { runId: activeRun })))}
        >
          <Square size={10} /> Stop
        </button>
      )}
    </p>
  );
}

/** Why a look started, finishing the sentence "Aiden looked 4 minutes ago, ...". */
const lookedBecause: Record<LookReason, string> = {
  you: 'because you asked',
  commit: 'after new commits',
  ticket: 'after a ticket status changed',
  morning: 'for the morning check',
  intent: 'after you changed the scope',
  answer: 'after your answer',
};

/** When Aiden last finished a look, and why it looked. */
function lastLook(runs: RunManifest[]): string {
  const look = runs.find((r) => r.kind === 'report' && r.status === 'completed');
  if (!look) return '';
  return `Last checked ${timeAgo(look.createdAt)}${look.reason ? `, ${lookedBecause[look.reason]}` : ''}.`;
}

/**
 * The project name and when Aiden last looked. The monitored branch is a tooltip on that line
 * unless it needs attention: not configured yet, or paused because the project is closed.
 */
function TitleLines({
  workspace,
  monitoring,
}: {
  workspace: Workspace;
  monitoring: string;
}): JSX.Element {
  const closed = workspace.project.lifecycle?.status === 'closed';
  const when = lastLook(workspace.runs.filter((run) => run.id === workspace.report?.id));
  const inline = closed || !workspace.project.repositories.some((repo) => repo.monitoredBranch);
  return (
    <div>
      <h1>{scopeName(workspace.project.context, workspace.baseline?.product, true)}</h1>
      {when && (
        <p className="brief-when" title={inline ? undefined : `Monitoring ${monitoring}`}>
          {when}
        </p>
      )}
      {inline && (
        <p className="brief-when">
          {closed ? 'Monitoring paused for' : 'Monitoring'} {monitoring}
        </p>
      )}
    </div>
  );
}

/** Where the project stands, what stopped, and the button that recovers from it. */
function StatusCard({
  workspace,
  headline,
  lands,
  progress,
  delivery,
  note,
}: {
  workspace: Workspace;
  headline: string;
  lands: string;
  progress: ReactNode;
  delivery: CodingDeliveryState;
  note: { text: string; label: string; run: () => void } | null;
}): JSX.Element {
  const closed = workspace.project.lifecycle?.status === 'closed';
  const { open, guide } = useProjectGuide();
  const savedResult = guide.view?.thread.messages.filter((m) => m.result).at(-1)?.result;
  return (
    <section className="brief-card" aria-label="Status">
      <div className="card-label-row">
        <h2 className="card-label">Latest check</h2>
        {savedResult && (
          <button
            className="text-button"
            onClick={() => open({ type: 'result', runId: savedResult.runId })}
          >
            View results in chat
          </button>
        )}
        <button
          disabled={workspace.busy || closed}
          onClick={() => {
            open({ type: 'run' });
            void workspace.lookNow();
          }}
        >
          Run check now
        </button>
      </div>
      {!progress && <h2 className="card-label">Overall progress</h2>}
      {delivery.error && <p role="alert">{delivery.error}</p>}
      {(!workspace.report || !progress) && (
        <p className="brief-status">
          <strong>{headline}</strong> {lands}
        </p>
      )}
      {progress}
      {note && (
        <div className="brief-note">
          {note.text && <p>{note.text}</p>}
          <button className="secondary" disabled={workspace.busy || closed} onClick={note.run}>
            {note.label}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The top of the brief: the project and when Aiden last looked, then one card with where it
 * stands, what it is waiting on, anything that stopped, and what Aiden is doing right now.
 */
export function BriefHeader({
  workspace,
  headline,
  lands,
  note,
  progress,
  attention,
  delivery,
  navigation,
  showStatus = true,
  allDone = false,
}: {
  workspace: Workspace;
  headline: string;
  lands: string;
  progress?: ReactNode;
  attention?: ReactNode;
  navigation?: ReactNode;
  showStatus?: boolean;
  /** Every requirement is done, so the outcome decision is offered on the brief itself. */
  allDone?: boolean;
  delivery: CodingDeliveryState;
  /** Work that stopped early: what happened, and the button that recovers from it. */
  note: { text: string; label: string; run: () => void } | null;
}): JSX.Element {
  const monitoring = monitoringLabel(workspace.project.repositories);
  return (
    <>
      <header className="brief-top">
        <TitleLines workspace={workspace} monitoring={monitoring} />
      </header>
      <ProjectOutcome key={workspace.project.id} workspace={workspace} quiet={!allDone} />
      {navigation}
      {showStatus && attention}
      {showStatus && (
        <StatusCard
          workspace={workspace}
          headline={headline}
          lands={lands}
          progress={progress}
          delivery={delivery}
          note={note}
        />
      )}
      <LiveLine workspace={workspace} />
    </>
  );
}

/**
 * Which branch each repository follows. With several repositories each branch is named by its
 * folder ("rolldown on origin/main, vite on origin/main"); before any branch is chosen, one
 * "not configured" stands for the whole project instead of one per repository.
 */
export function monitoringLabel(repositories: Workspace['project']['repositories']): string {
  if (!repositories.some((repo) => repo.monitoredBranch)) return 'not configured';
  return repositories
    .map((repo) => {
      const name = repo.path.split(/[\\/]/).at(-1);
      const branch = repo.monitoredBranch
        ? `${repo.monitoredBranch.remote}/${repo.monitoredBranch.branch}`
        : null;
      if (repositories.length === 1) return branch ?? 'not configured';
      return branch ? `${name} on ${branch}` : `${name} not configured`;
    })
    .join(', ');
}
