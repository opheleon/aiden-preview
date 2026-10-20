import type { JSX } from 'react';

import type { ActivityEntry } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import { activeTitles, runTitle } from '../renderer/run-labels';
import { GuideCheckResults } from './GuideCheckResults';

/** Follow every active check in the conversation, retaining results and stopped states inline. */
export function GuideRunStatus({
  workspace,
  visible,
  saved,
}: {
  workspace: Workspace;
  visible: boolean;
  /** Run IDs whose results the thread already holds, so they are not repeated here. */
  saved: ReadonlySet<string>;
}): JSX.Element | null {
  if (!visible) return null;
  const ids = workspace.activeRuns.length
    ? workspace.activeRuns
    : workspace.busy && workspace.activeRun
      ? [workspace.activeRun]
      : [];
  const latest = workspace.runs[0];
  const stopped =
    !workspace.busy && latest && (latest.status === 'failed' || latest.status === 'cancelled');
  return (
    <section className="guide-checks" aria-label="Checks in this chat">
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {workspace.busy && !ids.length && (
        <p className="guide-thinking" role="status">
          <span>Starting the check</span>
        </p>
      )}
      {ids.map((id) => {
        const run = workspace.runs.find((item) => item.id === id);
        const live = workspace.liveByRun[id] || (ids.length === 1 ? workspace.live : '');
        const detail = currentActivity(
          live,
          workspace.activity.find((entry) => entry.runId === id),
        );
        return (
          <div key={id} className="guide-check-progress">
            <div className="guide-check-heading">
              <p className="guide-thinking" role="status" aria-label="Project work in progress">
                <span>{run ? activeTitles[run.kind] : 'Starting the check'}</span>
              </p>
              <button
                className="text-button"
                onClick={() =>
                  void workspace.action(async () => {
                    await workspace.call('cancel', { runId: id });
                  })
                }
              >
                Stop
              </button>
            </div>
            {detail && <p className="guide-check-live">{detail}</p>}
          </div>
        );
      })}
      {stopped && (
        <p role="status">
          {runTitle(latest, false)}. {latest.error || 'You can ask Aiden to try again.'}
        </p>
      )}
      <GuideCheckResults workspace={workspace} activeIds={ids} saved={saved} />
    </section>
  );
}

/** Show concrete work, leaving generic run introductions and terse stage labels to the heading. */
function currentActivity(live: string, latest?: ActivityEntry): string | undefined {
  const introduction = latest?.kind === 'look' ? latest.summary : undefined;
  return [live, latest?.summary].find(
    (line) => line?.trim() && line !== introduction && !/^[a-z]+(?:\.{3}|…)$/i.test(line.trim()),
  );
}
