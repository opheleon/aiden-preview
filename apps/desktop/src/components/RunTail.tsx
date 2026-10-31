import { type JSX, useRef } from 'react';

import type { RunManifest } from '../../../../packages/contracts/src/index';
import { useRunLog } from '../hooks/useRunLog';
import { useStickToBottom } from '../hooks/useStickToBottom';
import type { Workspace } from '../hooks/useWorkspace';
import { runTitle } from '../renderer/run-labels';

/** A step's time of day with seconds, as a terminal log shows it, for example "14:02:11". */
function stamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

/**
 * A live tail of one run, terminal style: every step it took, such as each file read, search,
 * and browser action, oldest first, with new steps added as the worker reports them. It follows
 * the newest line until the person scrolls up, then offers a way back.
 * Example: "14:02:11  Searched aiden-teams for "slack"".
 */
export function RunTail({
  workspace,
  run,
  active,
}: {
  workspace: Workspace;
  run: RunManifest;
  active: boolean;
}): JSX.Element {
  const entries = useRunLog(workspace, run.id);
  const lines = useRef<HTMLOListElement>(null);
  const { behind, follow } = useStickToBottom(lines, true);
  return (
    <section className="run-tail" aria-label="Run log">
      <header className="run-tail-head">
        <span>{runTitle(run, active)}</span>
        {active && <span className="run-tail-live">Live</span>}
      </header>
      <ol ref={lines} className="run-tail-lines" role="log" aria-live="polite">
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            <time dateTime={entry.at}>{stamp(entry.at)}</time>
            <span>{entry.summary}</span>
          </li>
        ))}
        {!entries.length && <li className="run-tail-empty">Nothing logged yet.</li>}
      </ol>
      {behind && (
        <button className="run-tail-jump" onClick={follow}>
          Jump to latest
        </button>
      )}
    </section>
  );
}
