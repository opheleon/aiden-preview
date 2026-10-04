import type { JSX } from 'react';

import type { RunManifest } from '../../../../packages/contracts/src/index';
import { RunDetail } from '../components/RunDetail';
import { useNow } from '../hooks/useNow';
import type { Workspace } from '../hooks/useWorkspace';
import { runBlockage } from '../renderer/run-blockers';
import { duration, runReasons, runStatus, runTitle } from '../renderer/run-labels';
import { clockTime } from '../renderer/time';

/** Whether the worker is executing the run right now. */
const isActive = (workspace: Workspace, run: RunManifest): boolean =>
  workspace.activeRuns.includes(run.id);

/** One run in the list: what it was, why, how long, and what it is doing now. */
function RunRow({
  workspace,
  run,
  now,
}: {
  workspace: Workspace;
  run: RunManifest;
  now: number;
}): JSX.Element {
  const active = isActive(workspace, run);
  const blockage = runBlockage(run, workspace.calls, workspace.baseline);
  const status = runStatus(run, active, blockage);
  const latest = workspace.liveByRun[run.id];
  return (
    <li>
      <button className="run-row" onClick={() => workspace.setOpenRun(run.id)}>
        <span className="row-main">
          <span className="row-title">
            {runTitle(run, active)}
            <span className="row-sub">
              {' '}
              · {clockTime(run.createdAt)}
              {run.reason ? ` · ${runReasons[run.reason]}` : ''}
            </span>
          </span>
          <span className="row-sub">
            {blockage
              ? `Needs an answer: ${blockage.calls[0]!.question}`
              : active
                ? `Now: ${latest ?? 'Starting'}`
                : run.error && run.status === 'failed'
                  ? run.error
                  : (latest ?? '')}
          </span>
        </span>
        <span className="row-side">
          {active && <span className="row-sub">{duration(now - Date.parse(run.createdAt))}</span>}
          <span className={`chip chip--${status.tone}`}>{status.label}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Every run Aiden made on the project, newest first, with the ones in progress updating live.
 * Opening one shows its full history and what it is doing right now.
 */
export function Runs({ workspace }: { workspace: Workspace }): JSX.Element {
  const { runs, openRun, project } = workspace;
  const now = useNow(workspace.activeRuns.length > 0);
  const open = runs.find((r) => r.id === openRun);
  if (open)
    return <RunDetail workspace={workspace} run={open} active={isActive(workspace, open)} />;
  return (
    <div className="brief">
      <header className="brief-top">
        <div>
          <h1>Runs</h1>
          <p className="brief-when">Everything Aiden did on {project.name}, newest first.</p>
        </div>
      </header>
      <section className="brief-card" aria-label="All runs">
        {runs.length ? (
          <ul className="card-rows run-list">
            {runs.map((run) => (
              <RunRow key={run.id} workspace={workspace} run={run} now={now} />
            ))}
          </ul>
        ) : (
          <p className="card-empty">No runs yet.</p>
        )}
      </section>
    </div>
  );
}
