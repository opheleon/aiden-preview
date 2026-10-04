import { MoreHorizontal, Square } from 'lucide-react';
import { type JSX, type ReactNode, useRef } from 'react';

import type { LookReason, RunManifest } from '../../../../packages/contracts/src/index';
import { scopeName } from '../../../../packages/contracts/src/project-name';
import type { CodingDeliveryState } from '../hooks/useCodingDelivery';
import type { Workspace } from '../hooks/useWorkspace';
import { timeAgo } from '../renderer/time';
const api = window.aiden;

/** The overflow menu: the few things that are not touch points stay one click away. */
function Overflow({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, report, busy, lookNow, action, setNotice, setArea, setSettingsTab } = workspace;
  const menu = useRef<HTMLDetailsElement>(null);
  /** Close the menu, then act, so the next open starts fresh. */
  const choose = (fn: () => void) => () => {
    if (menu.current) menu.current.open = false;
    fn();
  };
  /** Save the latest report in the chosen format. */
  const exportAs = (format: 'markdown' | 'json') =>
    void action(async () => {
      if (report && (await api?.saveExport({ projectId: project.id, runId: report.id, format })))
        setNotice(`${format === 'json' ? 'JSON' : 'Markdown'} report exported.`);
    });
  return (
    <details className="overflow-menu" ref={menu}>
      <summary aria-label="More">
        <MoreHorizontal size={16} />
      </summary>
      <div role="menu">
        <button role="menuitem" disabled={busy} onClick={choose(() => void lookNow())}>
          Run check now
        </button>
        <button role="menuitem" disabled={!report} onClick={choose(() => exportAs('markdown'))}>
          Export Markdown
        </button>
        <button role="menuitem" disabled={!report} onClick={choose(() => exportAs('json'))}>
          Export JSON
        </button>
        <button
          role="menuitem"
          onClick={choose(() => {
            setSettingsTab('project');
            setArea('settings');
          })}
        >
          Project settings
        </button>
      </div>
    </details>
  );
}

/** What Aiden is doing right now, with a way to stop it. */
function LiveLine({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const { busy, live, activeRun, action, call, setArea, setOpenRun } = workspace;
  if (!busy) return null;
  return (
    <p className="live-line" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {live || 'Aiden is working.'}
      {activeRun && (
        <button
          className="text-button"
          onClick={() => {
            setOpenRun(activeRun);
            setArea('runs');
          }}
        >
          Watch it work
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
}: {
  workspace: Workspace;
  headline: string;
  lands: string;
  progress?: ReactNode;
  attention?: ReactNode;
  navigation?: ReactNode;
  showStatus?: boolean;
  delivery: CodingDeliveryState;
  /** Work that stopped early: what happened, and the button that recovers from it. */
  note: { text: string; label: string; run: () => void } | null;
}): JSX.Element {
  const when = lastLook(workspace.runs.filter((run) => run.id === workspace.report?.id));
  return (
    <>
      <header className="brief-top">
        <div>
          <h1>{scopeName(workspace.project.context, workspace.baseline?.product)}</h1>
          {when && <p className="brief-when">{when}</p>}
          <p className="brief-when">
            Monitoring{' '}
            {workspace.project.repositories
              .map((repo) =>
                repo.monitoredBranch
                  ? `${repo.monitoredBranch.remote}/${repo.monitoredBranch.branch}`
                  : 'not configured',
              )
              .join(', ')}{' '}
            <button
              className="text-button"
              onClick={() => {
                workspace.setSettingsTab('project');
                workspace.setArea('settings');
              }}
            >
              Change branch
            </button>
          </p>
        </div>
        <div className="button-row">
          <button disabled={delivery.refreshing} onClick={() => void delivery.refresh()}>
            {delivery.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <Overflow workspace={workspace} />
        </div>
      </header>
      {navigation}
      {showStatus && attention}
      {showStatus && (
        <section className="brief-card" aria-label="Status">
          {!progress && <h2 className="card-label">Overall progress</h2>}
          {delivery.error && <p role="alert">{delivery.error}</p>}
          {progress ?? (
            <p className="brief-status">
              <strong>{headline}</strong> {lands}
            </p>
          )}
          {note && (
            <div className="brief-note">
              {note.text && <p>{note.text}</p>}
              <button className="secondary" disabled={workspace.busy} onClick={note.run}>
                {note.label}
              </button>
            </div>
          )}
        </section>
      )}
      <LiveLine workspace={workspace} />
    </>
  );
}
