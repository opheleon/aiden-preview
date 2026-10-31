import type { JSX } from 'react';

import type { ActivityEntry } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import { runTitle } from '../renderer/run-labels';
import { GuideCheckResults } from './GuideCheckResults';

/** The checks running in this project now, or the one just starting. */
export function activeRunIds(workspace: Workspace): string[] {
  if (workspace.activeRuns.length) return workspace.activeRuns;
  return workspace.busy && workspace.activeRun ? [workspace.activeRun] : [];
}

/**
 * Follow every active check in the conversation: what it is doing now, then its results and any
 * stopped state. Its title and Stop live in the chat's status line, so they show once.
 */
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
  const ids = activeRunIds(workspace);
  const latest = workspace.runs[0];
  const stopped =
    !workspace.busy && latest && (latest.status === 'failed' || latest.status === 'cancelled');
  return (
    <section className="guide-checks" aria-label="Checks in this chat">
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {ids.map((id) => {
        const live = workspace.liveByRun[id] || (ids.length === 1 ? workspace.live : '');
        const detail = currentActivity(
          live,
          workspace.activity.find((entry) => entry.runId === id),
        );
        return (
          <div key={id} className="guide-check-progress">
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
