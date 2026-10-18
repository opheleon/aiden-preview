import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import { activeTitles, runTitle } from '../renderer/run-labels';
import { GuideCheckResults } from './GuideCheckResults';

/** Follow every active check in the conversation, retaining results and stopped states inline. */
export function GuideRunStatus({
  workspace,
  visible,
}: {
  workspace: Workspace;
  visible: boolean;
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
        const lines = workspace.activity
          .filter((entry) => entry.runId === id && entry.summary !== live)
          .slice(0, 3)
          .reverse();
        return (
          <div key={id} className="guide-check-progress">
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
            {lines.length > 0 && (
              <ul className="guide-check-activity">
                {lines.map((entry) => (
                  <li key={`${entry.at}:${entry.summary}`}>{entry.summary}</li>
                ))}
              </ul>
            )}
            {live && <p className="guide-check-live">{live}</p>}
          </div>
        );
      })}
      {stopped && (
        <p role="status">
          {runTitle(latest, false)}. {latest.error || 'You can ask Aiden to try again.'}
        </p>
      )}
      <GuideCheckResults workspace={workspace} activeIds={ids} />
    </section>
  );
}
